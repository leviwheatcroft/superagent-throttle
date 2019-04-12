import Throttle from '../lib/index'
import nock from 'nock'
import { assert } from 'chai'
import request from 'superagent'
import _ from 'lodash'
import debug from 'debug'

const debugThrottle = debug('superagent-throttle')

nock('http://stub')
.get('/time')
.times(1000)
.reply(201, () => Date.now())

nock('http://stub')
.get('/delay')
.socketDelay(2000)
.times(1000)
.reply(200, '<html></html>')

nock('http://stub')
.get('/error')
.times(1000)
.reply(400)

nock('http://stub')
.get('/redirect')
.times(1000)
.reply(301, '', {
  'Location': 'http://stub/delay'
})

nock('http://stub')
.get('/redirect-to-error')
.times(1000)
.reply(301, '', {
  'Location': 'http://stub/error'
})

nock.disableNetConnect()

/**
 * ## log
 *
 * a helper to write pretty tables when attached to Throttle events
 */
function log (prefix) {
  let count = 0
  let start = Date.now()
  return (request) => {
    if (!debugThrottle.enabled) return
    let rate
    let check = new Date(Date.now() - request.throttle.ratePer)
    rate = request.throttle._requestTimes.length - 1 - _.findLastIndex(
      request.throttle._requestTimes,
      (date) => (date < check)
    )
    count += 1
    console.log([
      '| ',
      _.padEnd(prefix, 10, ' '),
      '| ',
      _.padStart(count, 3, ' '),
      ' | ',
      _.padStart(Date.now() - start, 6, ' '),
      ' | conc: ',
      _.padStart(request.throttle._current, 3, ' '),
      ' | rate: ',
      _.padStart(rate, 3, ' '),
      ' | queued: ',
      _.padStart(request.throttle._buffer.length, 3, ' '),
      ' | ',
      request.serial
    ].join(''))
  }
}

/**
 * ## max
 *
 * collates various maximums, useful for tests
 */
function max () {
  let count = 0
  let maxRate = 0
  let maxConcurrent = 0
  let maxBuffer = 0
  return (request) => {
    if (request) {
      let rate
      let check = new Date(Date.now() - request.throttle.ratePer)
      rate = request.throttle._requestTimes.length - 1 - _.findLastIndex(
        request.throttle._requestTimes,
        (date) => (date < check)
      )
      count += 1
      if (maxConcurrent < request.throttle._current) {
        maxConcurrent = request.throttle._current
      }
      if (maxRate < rate) {
        maxRate = rate
      }
      if (maxBuffer < request.throttle._buffer.length) {
        maxBuffer = request.throttle._buffer.length
      }
    }
    return {
      count,
      maxRate,
      maxConcurrent,
      maxBuffer
    }
  }
}

describe('throttle', function () {
  this.timeout(15000)
  it('should clear errored requests (issue #6)', (done) => {
    let throttle = new Throttle()

    // `stub/delay` will return after 2000ms
    request
    .get('http://stub/delay')
    .timeout(1000)
    .use(throttle.plugin())
    .end((err) => {
      if (err) console.log(err)
      // console.log(throttle._current)
      assert(throttle._current === 0, 'request has not been cleared')
      done()
    })
  })

  it('should work with low concurrency', (done) => {
    let highest = max()
    let throttle = new Throttle({
      active: true,
      rate: 1000,
      ratePer: 2000,
      concurrent: 2
    })
    throttle.on('sent', highest)
    throttle.on('received', highest)

    _.times(10, function (idx) {
      request
      .get('stub/time')
      .use(throttle.plugin())
      .end()
    })

    throttle.on('drained', () => {
      let result = highest()
      assert(result.maxConcurrent === 2, 'highest concurrency was 2')
      done()
    })
  })

  it('should work with low rate', (done) => {
    let highest = max()
    let throttle = new Throttle({
      active: true,
      rate: 2,
      ratePer: 1000,
      concurrent: 2
    })
    throttle.on('sent', highest)
    throttle.on('received', highest)
    throttle.on('sent', log('sent'))
    throttle.on('received', log('rcvd'))

    _.times(10, (idx) => {
      request
      .get('stub/time')
      .use(throttle.plugin())
      .end()
    })

    throttle.on('drained', () => {
      let result = highest()
      assert(result.maxRate === 2, 'highest rate was 2')
      done()
    })
  })

  it('should work when resource bound (issue #6)', (done) => {
    let highest = max()
    let throttle = new Throttle({
      active: true,
      rate: 1000,
      ratePer: 5000,
      concurrent: 1000
    })
    throttle.on('sent', highest)
    throttle.on('received', highest)
    throttle.on('sent', log('sent'))
    throttle.on('received', log('rcvd'))

    _.times(500, function (idx) {
      request
      .get('stub/time')
      .use(throttle.plugin())
      .end()
    })

    throttle.on('drained', () => {
      assert.isOk(true, 'has thrown error?')
      done()
    })
  })

  /**
   * ## it should allow serialised queues
   *
   * this test is pretty ugly, but I can't think of a better way for the time
   * being. Basically there's an array of serial identifiers, which are attached
   * to requests, then as they come back those identifiers are stored, and teh
   * test is passed if no serialised requests come back consecutively.
   *
   * a better test would ensure that no two serial requests for the same uri
   * are requested simultaneously. But for now this will do.
   *
   */
  it('should allow serialised queues', (done) => {
    let throttle = new Throttle({
      active: true,
      rate: 10,
      ratePer: 5000,
      concurrent: 2
    })
    // throttle.on('sent', log('sent'))
    // throttle.on('received', log('rcvd'))

    let uris = [
      undefined,
      'someUri',
      'someUri',
      'someUri',
      undefined,
      undefined,
      undefined,
      undefined
    ]
    let responses = []

    _.each(uris, (uri) => {
      request.get('http://stub/time')
      .use(throttle.plugin(uri))
      .end((err, res) => {
        if (err) console.log(err)
        else responses.push(request.serial)
      })
    })

    throttle.on('drained', () => {
      // responses should not have two consecutive 'someUri'
      let consecutive = _.some(responses, (response, idx) => {
        if (idx === 0) return
        if (
          (responses[idx - 1] === 'someUri') &&
          (responses[idx] === 'someUri')
        ) return true
      })
      assert.isOk(!consecutive, 'requests have not been serialised')
      done()
    })
  })

  it('should not break end handler (issue #5)', (done) => {
    let throttle = new Throttle()

    request
    .get('stub/time')
    .use(throttle.plugin())
    .end(() => {
      assert.isOk(true, 'end handler not working?')
      done()
    })
  })

  it('should return superagent instance (issue #2)', () => {
    let throttle = new Throttle()

    let instance = request.get('stub/time')
    let returned = instance.use(throttle.plugin())
    assert(instance === returned, 'instance not returned')
  })

  it('should not throw error when error listeners are attached', done => {
    const throttle = new Throttle()
      .on('error', () => null)
    const instance = request.get('stub/error')
      .use(throttle.plugin())

    assert.doesNotThrow(() =>
      instance.end(() => done())
    )
  })

  it('should work with redirects', (done) => {
    let throttle = new Throttle()

    // currently failing with uncatchable 'Maximum Call Stack Size Exceeded'
    request
    .get('http://stub/redirect')
    .use(throttle.plugin())
    .end((err) => {
      if (err) console.log(err)
      done()
    })
  })
  it('should work with lots of redirects', (done) => {
    let highest = max()
    let throttle = new Throttle({
      active: true,
      rate: 10,
      ratePer: 500,
      concurrent: 5
    })
    throttle.on('sent', highest)
    throttle.on('received', highest)
    throttle.on('sent', log('sent'))
    throttle.on('received', log('rcvd'))

    _.times(20, function (idx) {
      request
      .get('stub/redirect')
      .use(throttle.plugin())
      .end()
    })

    throttle.on('drained', () => {
      assert.isOk(true, 'has thrown error?')
      done()
    })
  })
  it('should work with reject request', (done) => {
    let throttle = new Throttle({
      active: true,
      rate: 1,
      ratePer: 200,
      concurrent: 1
    })
    const req = request
      .get('stub/time')
      .use(throttle.plugin())
      .end()

    req.abort()

    request
      .get('stub/time')
      .use(throttle.plugin())
      .end(() => {
        done()
      })
  })
})
