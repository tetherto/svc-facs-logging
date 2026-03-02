'use strict'

const async = require('async')
const Base = require('@bitfinex/bfx-facs-base')
const fs = require('fs')
const pino = require('pino')

class LoggingFacility extends Base {
  constructor (caller, opts, ctx) {
    super(caller, opts, ctx)
    this._hasConf = true

    this.name = 'logging'
    this.logger = null

    if (!this.opts.name || typeof this.opts.name !== 'string') {
      throw new Error('ERR_INVALID_NAME')
    }

    if (this.opts.mixin && typeof this.opts.mixin !== 'function') {
      throw new Error('ERR_INVALID_MIXIN')
    }

    this.init()
  }

  init () {
    const confPath = this._getConfPath()
    if (!fs.existsSync(confPath)) {
      const defaultConfig = {
        [this.opts.ns]: {
          debug: 0,
          transport: {
            enabled: false
          }
        }
      }
      fs.writeFileSync(confPath, JSON.stringify(defaultConfig, null, 2))
    }
    super.init()
  }

  _start (cb) {
    async.series([
      next => { super._start(next) },
      async () => {
        this._initializeLogger()
      }
    ], cb)
  }

  _initializeLogger () {
    const name = this.opts.name
    const level = this.conf.debug === 0 ? 'info' : 'debug'
    const enabled = this.opts.enabled ?? true

    const baseConfig = {
      name,
      level,
      enabled,
      ...(this.opts.mixin && { mixin: this.opts.mixin })
    }

    if (this._hasTransportOptions()) {
      console.log('Creating logger with transport')
      this.logger = this._createLoggerWithTransport(baseConfig)
    } else {
      console.log('Creating fallback logger')
      this.logger = this._createFallbackLogger(baseConfig)
    }
  }

  _hasTransportOptions () {
    return !!(
      this.conf?.transport?.enabled &&
      this.conf?.transport?.topic &&
      this.conf?.transport?.secretKey
    )
  }

  _createLoggerWithTransport (baseConfig) {
    const stdout = pino.destination(1)
    const stderr = pino.destination(2)

    const hyperswarmTransport = pino.transport({
      target: './lib/pino-hyperswarm-exporter',
      options: {
        app: baseConfig.name,
        topic: this.conf.transport.topic,
        secretKey: this.conf.transport.secretKey,
        maxRetries: this.conf.transport.maxRetries || 3,
        retryDelay: this.conf.transport.retryDelay || 200
      }
    })

    const consoleStream = pino.multistream([
      // should do debug,info and if debug is disabled, should do info
      { level: 'debug', stream: stdout },
      // should do warn,error,fatal
      { level: 'warn', stream: stderr }
    ], { dedupe: true })

    const combinedStream = pino.multistream([
      { level: 'trace', stream: hyperswarmTransport },
      { level: 'trace', stream: consoleStream }
    ])

    return pino(baseConfig, combinedStream)
  }

  _createFallbackLogger (baseConfig) {
    const stdout = pino.destination(1)
    const stderr = pino.destination(2)

    return pino(
      baseConfig,
      pino.multistream([
        { level: 'debug', stream: stdout },
        { level: 'info', stream: stdout },
        { level: 'error', stream: stderr },
        { level: 'warn', stream: stderr },
        { level: 'fatal', stream: stderr }
      ], { dedupe: true })
    )
  }

  _stop (cb) {
    async.series([
      next => { super._stop(next) },
      async () => {
        if (this.logger) {
          this.logger.flush()
          delete this.logger
        }
      }
    ], cb)
  }
}

module.exports = LoggingFacility
