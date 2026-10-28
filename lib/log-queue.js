'use strict'

class LogQueue {
  constructor (opts = {}) {
    this.maxSize = opts.maxSize || 5000
    this._encodeDropped = opts.encodeDropped || null
    this._socket = null
    this._frames = []
    this._dropped = 0
    this._flushing = false
    this._waiters = []
  }

  get size () {
    return this._frames.length
  }

  get dropped () {
    return this._dropped
  }

  get socket () {
    return this._socket && !this._socket.destroyed ? this._socket : null
  }

  attach (socket) {
    this._socket = socket
    this._flush()
  }

  detach (socket) {
    if (this._socket === socket) this._socket = null
  }

  push (frame) {
    if (this._frames.length >= this.maxSize) {
      this._frames.shift()
      this._dropped++
    }
    this._frames.push(frame)
    this._flush()
  }

  drain (timeout) {
    if (this._isEmpty()) return Promise.resolve(true)

    return new Promise((resolve) => {
      const waiter = (done) => {
        clearTimeout(timer)
        resolve(done)
      }
      const timer = setTimeout(() => {
        this._waiters = this._waiters.filter((w) => w !== waiter)
        resolve(false)
      }, timeout)
      this._waiters.push(waiter)
    })
  }

  _isEmpty () {
    return this._frames.length === 0 && this._dropped === 0
  }

  _takeDroppedNotice () {
    if (!this._dropped || !this._encodeDropped) return
    this._frames.unshift(this._encodeDropped(this._dropped))
    this._dropped = 0
  }

  async _flush () {
    if (this._flushing) return
    const socket = this.socket
    if (!socket) return

    this._flushing = true
    try {
      this._takeDroppedNotice()
      while (this._frames.length && this.socket === socket) {
        const frame = this._frames.shift()
        if (!socket.write(frame)) await waitForDrain(socket)
      }
    } catch {
    } finally {
      this._flushing = false
    }

    if (this._isEmpty()) {
      this._resolveWaiters()
    } else if (this.socket && this.socket !== socket) {
      this._flush()
    }
  }

  _resolveWaiters () {
    const waiters = this._waiters
    this._waiters = []
    for (const waiter of waiters) waiter(true)
  }
}

function waitForDrain (socket) {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) {
      reject(new Error('ERR_SOCKET_CLOSED'))
      return
    }

    const cleanup = () => {
      socket.removeListener('drain', onDrain)
      socket.removeListener('close', onClose)
      socket.removeListener('error', onClose)
    }
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const onClose = () => {
      cleanup()
      reject(new Error('ERR_SOCKET_CLOSED'))
    }

    socket.on('drain', onDrain)
    socket.on('close', onClose)
    socket.on('error', onClose)
  })
}

module.exports = LogQueue
