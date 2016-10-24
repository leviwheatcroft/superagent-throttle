# superagent-throttle

![nodei.co](https://nodei.co/npm/superagent-throttle.png?downloads=true&downloadRank=true&stars=true)

![npm](https://img.shields.io/npm/v/superagent-throttle.svg)

A plugin for [superagent](https://github.com/visionmedia/superagent) that
  throttles requests. Useful for rate or concurrency limited APIs.

## Features

 * This doesn't just delay requests by an arbitrary number of ms, but
   intelligently manages requests so they're sent as soon as possible whilst
   staying beneath rate limits.
 * Can make serialised subqueues on the fly.
 * Follows [superagent](https://github.com/visionmedia/superagent)
   `.use(throttle.plugin())` architecture
 * Hackable
 * Should work with Browserify
 * Can use multiple instances

## Install

```
  npm i --save superagent
  npm i --save inherits
  npm i --save superagent-throttle
```

## Basic Usage

    var request     = require('superagent')
    var _           = require('underscore')
    var Throttle    = require('superagent-throttle')

    var throttle = new Throttle({
      active: true,     // set false to pause queue
      rate: 5,          // how many requests can be sent every `ratePer`
      ratePer: 10000,   // number of ms in which `rate` requests may be sent
      concurrent: 2     // how many requests can be sent concurrently
    })

    _.each(_.range(1, 15), function(iteration) {
      var width = 100 + iteration
      request
      .get('http://placekitten.com/' + width + '/100')
      .use(throttle.plugin())
      .end(function(err, res) {
        console.log(err ? err : 'retrieved ' + iteration)
      })
      console.log('added ' + iteration)
    })

## Serialised Sub Queues

When using API's to update a client, you may want some serialised requests which
still count towards your rate limit, but do not block other requests. You can
do that by passing a uri (not necessarily a valid url) to `throttle.plugin`, for
those requests you want to serialise, and leave it out for other async requests.
This can be done on the fly, you don't need to initialise subqueues first.

    var endpoint = 'http://example.com/endpoint'
    request
    .get(endpoint)
    .set('someData': someData)
    .use(throttle.plugin(endpoint))
    .end(callback)

it's common to use an endpoint for the uri, simply to serialise requests to that
endpoint without interfering with requests to other endpoints

## Options

 * `active`: whether or not the queue is paused.
 * `rate`: how many requests can be sent every `ratePer`
 * `ratePer`: number of ms in which `rate` requests may be sent
 * `concurrent`: how many requests can be sent concurrently

Options can be set after instantiation using the `set` method.

```javascript

    var throttle = new require('./index')({ active: false }) // start paused
    throttle.set('active', true) // unpause

```

## Advanced Usage

See [theMovieDbApi](https://github.com/leviwheatcroft/moviedb-api/blob/master/index.js)

## Api

See the [fancy annotated code](http://leviwheatcroft.github.io/superagent-throttle/docs/index.js.html).

## Author

Levi Wheatcroft <levi@wht.cr>

## Contributing

Contributions welcome; Please submit all pull requests against the master
branch.

## License

 - **MIT** : http://opensource.org/licenses/MIT
