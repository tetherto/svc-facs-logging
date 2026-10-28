'use strict'

const build = require('pino-abstract-transport')
const Hyperswarm = require('hyperswarm')
const b4a = require('b4a')
const { generateTopic } = require('./utils')
const LogQueue = require('./log-queue')

module.exports = function hyperswarmTransport (opts = {}) {
  if (!opts.topic) {
    throw new Error('ERR_MISSING_TOPIC')
  }
  if (!opts.app) {
    throw new Error('ERR_MISSING_APP_NAME')
  }
  if (!opts.secretKey) {
    throw new Error('ERR_MISSING_SECRET_KEY')
  }

  const topic = generateTopic(opts.topic)
  const swarm = new Hyperswarm()
  const flushTimeout = opts.flushTimeout ?? 2000
  const queue = new LogQueue({
    maxSize: opts.maxQueueSize,
    encodeDropped: encodeDroppedNotice
  })
  let closing = null

  console.log(`Hyperswarm transport using topic: ${b4a.toString(topic, 'hex')}`)

  swarm.on('connection', (socket, peerInfo) => {
    console.log('New peer connected:', peerInfo.publicKey.toString('hex'))

    socket.on('close', () => {
      console.log('Peer disconnected:', peerInfo.publicKey.toString('hex'))
      queue.detach(socket)
    })

    socket.on('error', (err) => {
      console.error('Socket error:', err.message, peerInfo.publicKey.toString('hex'))
      queue.detach(socket)
    })

    sendAuthMessage(socket, opts.app, opts.secretKey)
    queue.attach(socket)
  })

  swarm.join(topic, { server: false, client: true })

  function sendAuthMessage (socket, app, secretKey) {
    if (!socket || socket.destroyed) return

    const authMessage = {
      type: 'pino.auth',
      labels: {
        app,
        source: 'pino'
      },
      secretKey,
      timestamp: Date.now()
    }

    const buffer = b4a.from(JSON.stringify(authMessage))
    socket.write(buffer, (err) => {
      if (err) {
        console.error('Failed to send auth message:', err.message)
      } else {
        console.log(`Authentication message sent for app: ${app}`)
      }
    })
  }

  function encodeLog (logObj) {
    const timestamp = logObj.time || Date.now()
    const message = {
      type: 'pino.logs',
      timestamp,
      log: {
        timestamp,
        level: logObj.level,
        levelName: getLevelName(logObj.level),
        message: logObj.msg || '',
        ...logObj
      }
    }

    return b4a.from(JSON.stringify(message))
  }

  function encodeDroppedNotice (count) {
    return encodeLog({
      level: 40,
      time: Date.now(),
      name: opts.app,
      msg: `${count} log lines dropped while the log aggregator was unavailable`,
      droppedLogs: count
    })
  }

  function getLevelName (level) {
    if (level >= 60) return 'fatal'
    if (level >= 50) return 'error'
    if (level >= 40) return 'warn'
    if (level >= 30) return 'info'
    if (level >= 20) return 'debug'
    return 'trace'
  }

  function close () {
    if (!closing) closing = shutdown()
    return closing
  }

  function endSocket (socket, timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout)
      socket.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.end()
    })
  }

  async function shutdown () {
    const flushed = await queue.drain(flushTimeout)
    if (!flushed) {
      console.warn(`Log transport closing with ${queue.size} unsent log lines`)
    }
    if (queue.socket) await endSocket(queue.socket, flushTimeout)
    await swarm.leave(topic)
    await swarm.destroy()
    console.log('Hyperswarm transport shutdown complete')
  }

  return build(
    async function (source) {
      try {
        for await (const obj of source) {
          queue.push(encodeLog(obj))
        }
      } catch (error) {
        console.error('Transport error:', error)
      } finally {
        await close()
      }
    },
    {
      close
    }
  )
}
