var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;

// Throttle inherits from EventEmitter
inherits(Throttle, EventEmitter);

/**
 * ## default options
 */
var defaults = {
  // not sure if `name` is used anymore
  name: 'default',
  // start unpaused ?
  active: true,
  // requests per `ratePer` ms
  rate: 40,
  // ms per `rate` requests
  ratePer: 40000,
  // max concurrent requests
  concurrent: 20
}

/**
 * ## Throttle
 * The throttle object.
 *
 * @class
 * @param {object} options - key value options
 */
 
function Throttle(options) {
   EventEmitter.call(this);
   // instance properties
    this._options({
      _requestTimes: [0],
      _current: 0,
      _buffer: [],
      _serials: {},
      _timeout: false
    });
    this._options(defaults);
    this._options(options);
};


  /**
   * ## _options
   * updates options on instance
   *
   * @method
   * @param {Object} options - key value object
   * @returns null
   */
  Throttle.prototype._options = function(options) {
    for (var property in options) {
      if (options.hasOwnProperty(property)) {
        this[property] = options[property]
      }
    }
  }

  /**
   * ## options
   * thin wrapper for _options,
   *  * calls `this.cycle()`
   *  * adds alternate syntax
   *
   * alternate syntax:
   * throttle.options('active', true)
   * throttle.options({active: true})
   *
   * @method
   * @param {Object} options - either key value object or keyname
   * @param {Mixed} [value] - value for key
   * @returns null
   */
  Throttle.prototype.options = function(options, value) {
    if ((typeof options === 'string') && (value)) {
      options = { options: value };
    }
    this._options(options);
    this.cycle();
  }

  /**
   * ## next
   * checks whether instance has available capacity and calls throttle.send()
   *
   * @returns {Boolean}
   */
  Throttle.prototype.next = function() {
    var throttle = this;
    // make requestTimes `throttle.rate` long. Oldest request will be 0th index
    throttle._requestTimes = throttle._requestTimes.slice(throttle.rate * -1);

    if (
      // paused
      !(throttle.active) ||
      // at concurrency limit
      (throttle._current >= throttle.concurrent) ||
      // less than `ratePer`
      throttle._isRateBound() ||
      // something waiting in the throttle
      !(throttle._buffer.length)
    ) {
      return false;
    }
    var idx = throttle._buffer.findIndex(function(request) {
      return !request.serial || !throttle._serials[request.serial];
    });
    if (idx === -1) {
      throttle._isSerialBound = true;
      return false;
    }
    throttle.send(throttle._buffer.splice(idx, 1)[0]);
    return true;
  }

  /**
   * ## serial
   * updates throttle.\_serials and throttle.\_isRateBound
   *
   * serial subthrottles allow some requests to be serialised, whilst maintaining
   * their place in the queue. The _serials structure keeps track of what serial
   * queues are waiting for a response.
   *
   * ```
   * throttle._serials = {
   *   'example.com/end/point': true,
   *   'example.com/another': false
   * }
   * ```
   *
   * @param {Request} request superagent request
   * @param {Boolean} state new state for serial
   */
  Throttle.prototype.serial = function(request, state) {
    var serials = this._serials;
    var throttle = this;
    if (request.serial === false) {
      return;
    }
    if (state === undefined) {
      return serials[request.serial];
    }
    if (state === false) {
      throttle._isSerialBound = false;
    }
    serials[request.serial] = state;
  }

  /**
   * ## _isRateBound
   * returns true if throttle is bound by rate
   *
   * @returns {Boolean}
   */
  Throttle.prototype._isRateBound = function() {
    var throttle = this;
    return (
      ((Date.now() - throttle._requestTimes[0]) < throttle.ratePer) &&
      (throttle._buffer.length > 0)
    );
  }

  /**
   * ## cycle
   * an iterator of sorts. Should be called when
   *  - something added to throttle (check if it can be sent immediately)
   *  - `ratePer` ms have elapsed since nth last call where n is `rate` (may have
   *    available rate)
   *  - some request has ended (may have available concurrency)
   *
   * @param {Request} request the superagent request
   * @returns null
   */
  Throttle.prototype.cycle = function(request) {
    var throttle = this;
    if (request) {
      throttle._buffer.push(request);
    }
    clearTimeout(throttle._timeout);

    // fire requests
    // throttle.next will return false if there's no capacity or throttle is
    // drained
    while (throttle.next()) {}

    // if bound by rate, set timeout to reassess later.
    if (throttle._isRateBound()) {
      var timeout;
      // defined rate
      timeout = throttle.ratePer;
      // less ms elapsed since oldest request
      timeout -= (Date.now() - throttle._requestTimes[0]);
      // + 1 ms to ensure you don't fire a request exactly ratePer ms later
      throttle._timeout = setTimeout(function() {
        throttle.cycle();
      }, timeout);
    }
  }

  /**
   * ## send
   *
   * @param {Request} request superagent request
   * @returns null
   */
  Throttle.prototype.send = function(request) {
    var throttle = this;
    throttle.serial(request, true);
    // attend to the throttle once we get a response
    request.on('end', function() {
      throttle._current -= 1;
      throttle.emit('received', request);

      if (
        (!throttle._buffer.length) &&
        (!throttle._current)
      ) {
        throttle.emit('drained');
      }
      throttle.serial(request, false);
      throttle.cycle();
    })


    // original `request.end` was stored at `request.throttled`
    // original `callback` was stored at `request._callback`
    request.throttled.apply(request, [ request._callback ]);
    throttle._requestTimes.push(Date.now());
    throttle._current += 1;
    this.emit('sent', request);
  }

  /**
   * ## plugin
   *
   * `superagent` `use` function should refer to this plugin method a la
   * `.use(throttle.plugin())`
   *
   * @method
   * @param {string} serial any string is ok, it's just a namespace
   * @returns null
   */
  Throttle.prototype.plugin = function(serial) {
    var throttle = this;
    //var patch = function(request) {
    return function(request) {
      request.throttle = throttle;
      request.serial = serial || false;
      // replace request.end
      request.throttled = request.end;
      request.end = function(callback) {
        // store callback as superagent does
        request._callback = callback;
        // place this request in the queue
        request.throttle.cycle(request);
        return request;
      }
      return request;
    }
    //return _.isObject(serial) ? patch(serial) : patch
  }


module.exports = Throttle;
