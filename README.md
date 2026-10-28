# svc-facs-logging

Logging facility for `bfx-svc-boot-js` workers. It gives the worker a [pino](https://getpino.io) logger that writes to stdout/stderr and, when the transport is enabled, also forwards every log line over Hyperswarm to the log aggregator (`cosmicac-wrk-monitor`).

## Install

```sh
npm install @tetherto/svc-facs-logging
```

## Usage

Register the facility in the worker's `init()` and read the logger after the facilities have started:

```js
const WrkBase = require('bfx-wrk-base')
const async = require('async')

class MyWorker extends WrkBase {
  init () {
    super.init()

    this.setInitFacs([
      ['fac', '@tetherto/svc-facs-logging', 'l0', 'l0', { name: 'my-worker' }, 0]
    ])
  }

  _start (cb) {
    async.series([
      next => { super._start(next) },
      async () => {
        this.logger = this.logging_l0.logger
        this.logger.info({ jobId: 'abc' }, 'worker started')
      }
    ], cb)
  }
}
```

Workers built on `tether-wrk-base` already register it as `logging_l0` and expose it as `this.logger`.

### Facility options

Passed as the options object in `setInitFacs`:

| Option | Required | Description |
|---|---|---|
| `name` | yes | Logger name. Sent to the aggregator as the `app` label. |
| `mixin` | no | pino `mixin` function that adds fields to every log line. |
| `enabled` | no | Set `false` to silence the logger. Defaults to `true`. |

## Configuration

The facility reads `config/facs/logging.config.json` from the worker root, keyed by the facility namespace (`l0` above). An environment-specific `config/facs/<env>.logging.config.json` takes precedence when present. If no file exists, one is created with the transport disabled.

Sample `config/facs/logging.config.json`:

```json
{
  "l0": {
    "debug": 0,
    "transport": {
      "enabled": true,
      "topic": "@cosmicac/jobs-telemetry",
      "secretKey": "your-shared-telemetry-secret",
      "maxQueueSize": 5000,
      "flushTimeout": 2000
    }
  }
}
```

| Key | Default | Description |
|---|---|---|
| `debug` | | `0` logs at `info` and above. Any other value, or leaving it out, logs at `debug` and above. |
| `transport.enabled` | `false` | Forward logs over Hyperswarm. When off, logs only go to stdout/stderr. |
| `transport.topic` | | Hyperswarm topic. Must match the aggregator's `topic`. |
| `transport.secretKey` | | Shared secret sent in the auth message. Must match the aggregator's `secretKey`. |
| `transport.maxQueueSize` | `5000` | Log lines held while no aggregator connection is open. When full, the oldest lines are dropped. |
| `transport.flushTimeout` | `2000` | Milliseconds to wait on shutdown for queued lines to be sent. |

The transport is only used when `enabled`, `topic` and `secretKey` are all set.

## Delivery behaviour

- Log lines are always written to stdout (`debug`/`info`) and stderr (`warn` and above), with or without the transport.
- Lines logged before the aggregator is discovered, or while it is reconnecting, are queued and sent in order once a connection opens, right after the auth message.
- If the queue overflows, the aggregator receives a `warn` line reporting how many lines were dropped (`droppedLogs` field) before the remaining backlog.
- Queued lines are kept in memory only. They are lost if the process exits before a connection opens or before `flushTimeout` elapses on shutdown.
