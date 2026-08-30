import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'

const commandTimeoutMs = 15_000

/** Transport surface CdpConnection needs; injectable for tests. */
export interface CdpTransport {
  send(data: string): void
  close(): void
  onOpen(handler: () => void): void
  onMessage(handler: (data: string) => void): void
  onClose(handler: () => void): void
  onError(handler: (error: unknown) => void): void
}

export type CdpTransportFactory = (url: string) => CdpTransport

export class CdpError extends Error {
  readonly code?: number

  constructor(message: string, code?: number) {
    super(message)
    this.code = code
  }
}

/** Creates the default transport from Node's built-in WebSocket client. */
export function websocketTransport(url: string): CdpTransport {
  const socket = new WebSocket(url)
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onOpen: (handler) => socket.addEventListener('open', () => handler()),
    onMessage: (handler) =>
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') handler(event.data)
      }),
    onClose: (handler) => socket.addEventListener('close', () => handler()),
    onError: (handler) =>
      socket.addEventListener('error', () => handler(new Error('CDP socket error'))),
  }
}

interface PendingCommand {
  resolve: (value: JsonObject) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Minimal CDP JSON-RPC client: command/response with timeouts and event fan-out. */
export class CdpConnection {
  readonly #factory: CdpTransportFactory
  readonly #pending = new Map<number, PendingCommand>()
  readonly #handlers = new Map<string, Set<(params: JsonObject) => void>>()
  #socket: CdpTransport | null = null
  #nextId = 1
  #closed = false
  #disconnectedListeners: Array<() => void> = []

  constructor(factory: CdpTransportFactory = websocketTransport) {
    this.#factory = factory
  }

  /** Opens the connection; rejects on socket failure or timeout. */
  connect(url: string, timeoutMs = commandTimeoutMs): Promise<void> {
    if (typeof WebSocket === 'undefined' && this.#factory === websocketTransport) {
      return Promise.reject(new CdpError('This Node runtime has no built-in WebSocket client'))
    }
    const socket = this.#factory(url)
    this.#socket = socket
    socket.onMessage((data) => {
      try {
        const value: unknown = JSON.parse(data)
        if (isObject(value)) this.#receive(value)
      } catch {
        // Ignore malformed frames; CDP traffic is otherwise well-formed JSON.
      }
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new CdpError('CDP connection timed out')),
        timeoutMs,
      )
      const settle = (complete: () => void): void => {
        clearTimeout(timer)
        complete()
      }
      socket.onError((error) =>
        settle(() => reject(error instanceof Error ? error : new CdpError('CDP socket error')))
      )
      socket.onClose(() => {
        if (!this.#closed) {
          this.#handleDisconnect()
          settle(() => reject(new CdpError('CDP socket closed before connecting')))
        }
      })
      socket.onOpen(() => settle(() => resolve()))
    })
  }

  /** Sends a command and resolves with its `result` payload. */
  send(method: string, params?: JsonObject, timeoutMs = commandTimeoutMs): Promise<JsonObject> {
    const socket = this.#socket
    if (!socket || this.#closed) return Promise.reject(new CdpError('CDP connection is closed'))
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new CdpError(`CDP command timed out: ${method}`))
      }, timeoutMs)
      this.#pending.set(id, {
        resolve,
        reject,
        timer,
      })
      socket.send(JSON.stringify({ id, method, params: params ?? {} }))
    })
  }

  /** Subscribes to a CDP event; returns an unsubscribe function. */
  on(method: string, handler: (params: JsonObject) => void): () => void {
    const handlers = this.#handlers.get(method) ?? new Set()
    handlers.add(handler)
    this.#handlers.set(method, handlers)
    return () => handlers.delete(handler)
  }

  /** Registers a callback for unexpected transport loss. */
  onDisconnected(handler: () => void): void {
    this.#disconnectedListeners.push(handler)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#socket?.close()
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer)
      reject(new CdpError('CDP connection closed'))
    }
    this.#pending.clear()
  }

  #handleDisconnect(): void {
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer)
      reject(new CdpError('CDP connection lost'))
    }
    this.#pending.clear()
    for (const listener of this.#disconnectedListeners) listener()
    this.#disconnectedListeners = []
  }

  #receive(message: JsonObject): void {
    if (typeof message.id === 'number') {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      clearTimeout(pending.timer)
      if (isObject(message.error)) {
        const text = typeof message.error.description === 'string'
          ? message.error.description
          : typeof message.error.message === 'string'
          ? message.error.message
          : 'CDP error'
        pending.reject(
          new CdpError(
            text,
            typeof message.error.code === 'number' ? message.error.code : undefined,
          ),
        )
      } else {
        pending.resolve(isObject(message.result) ? message.result : {})
      }
      return
    }
    if (typeof message.method === 'string') {
      const handlers = this.#handlers.get(message.method)
      if (handlers) {
        for (const handler of handlers) handler(isObject(message.params) ? message.params : {})
      }
    }
  }
}
