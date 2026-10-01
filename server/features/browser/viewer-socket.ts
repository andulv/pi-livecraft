import type { BrowserInputEvent, BrowserSessionStatus } from '../../../shared/types.ts'
import { parseBrowserInputEvent, type BrowserSessionEvent } from './browser-session.ts'

/** An unacknowledged frame closes the viewer: a suspended tab must not regain credit. */
export const frameAckTimeoutMs = 5_000
/** Application liveness the tab can observe; protocol pings are invisible to page script. */
export const socketHeartbeatIntervalMs = 10_000
export const socketPingIntervalMs = 15_000
/** Bounds the sequential input dispatch queue when CDP accepts input slowly. */
export const maxQueuedSocketInput = 256

/** The subset of `ws` the viewer session needs; a fake in tests implements the same. */
export interface ViewerSocket {
  send(data: string | Buffer, options?: { binary?: boolean }): void
  close(code?: number, reason?: string): void
  on(event: 'message', listener: (data: string) => void): void
  on(event: 'close', listener: () => void): void
  on(event: 'error', listener: () => void): void
  ping(): void
}

/** The subset of `BrowserSession` the viewer session needs. */
export interface ViewerSession {
  status(): BrowserSessionStatus
  currentFrame(): Buffer | undefined
  subscribe(listener: (event: BrowserSessionEvent) => void): () => void
  addViewer(): void
  releaseViewer(): void
  dispatchInput(event: BrowserInputEvent): Promise<void>
}

export interface ViewerSocketOptions {
  ackTimeoutMs?: number
  heartbeatIntervalMs?: number
  pingIntervalMs?: number
  maxQueuedInput?: number
}

/**
 * One browser viewer on one WebSocket. Frames are JPEG bytes sent as binary messages,
 * paced by a single credit: the tab acknowledges a frame once decoded, and until then only
 * the newest frame is retained. The browser's WebSocket API has no receive-side
 * backpressure, so this credit is the only signal of the tab's real pace. Input arrives on
 * the same socket and is dispatched to CDP sequentially, preserving order. See
 * plans/proposals/browser-websocket-transport.md.
 */
export function attachViewerSocket(
  socket: ViewerSocket,
  session: ViewerSession,
  options: ViewerSocketOptions = {},
): void {
  const ackTimeoutMs = options.ackTimeoutMs ?? frameAckTimeoutMs
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? socketHeartbeatIntervalMs
  const pingIntervalMs = options.pingIntervalMs ?? socketPingIntervalMs
  const maxQueuedInput = options.maxQueuedInput ?? maxQueuedSocketInput

  let closed = false
  let awaitingAck = false
  let pending: Buffer | null = null
  let ackTimer: ReturnType<typeof setTimeout> | undefined
  let inputQueue: BrowserInputEvent[] = []
  let dispatching = false

  const sendJson = (value: unknown): void => {
    if (!closed) socket.send(JSON.stringify(value))
  }

  const sendFrame = (buffer: Buffer): void => {
    awaitingAck = true
    ackTimer = setTimeout(() => {
      // Never restore credit: the visibility-aware reconnect establishes fresh state.
      socket.close(4004, 'Frame acknowledgement timed out')
    }, ackTimeoutMs)
    ackTimer.unref?.()
    if (!closed) socket.send(buffer, { binary: true })
  }

  const dispatchInput = (): void => {
    if (dispatching) return
    const next = inputQueue.shift()
    if (!next) return
    dispatching = true
    void session
      .dispatchInput(next)
      .catch(() => {})
      .finally(() => {
        dispatching = false
        if (!closed && inputQueue.length > 0) dispatchInput()
      })
  }

  const unsubscribe = session.subscribe((event) => {
    if (closed) return
    if (event.type === 'frame') {
      if (awaitingAck) pending = event.buffer
      else sendFrame(event.buffer)
      return
    }
    if (event.type === 'viewport') {
      // Frames of the old capture size must not display after the change.
      pending = null
      return
    }
    if (event.type === 'status') sendJson({ type: 'status', status: event.status })
    else if (event.type === 'url') sendJson({ type: 'url', url: event.url })
  })

  session.addViewer()
  socket.on('message', (data: string) => {
    let value: unknown
    try {
      value = JSON.parse(data)
    } catch {
      return
    }
    if (!value || typeof value !== 'object') return
    const message = value as { type?: unknown; event?: unknown }
    if (message.type === 'frameAck') {
      // Only a frame outstanding can be acknowledged; anything else is ignored, which by
      // itself makes duplicate or stale acknowledgements harmless.
      if (!awaitingAck) return
      awaitingAck = false
      if (ackTimer !== undefined) clearTimeout(ackTimer)
      if (pending) {
        const queued = pending
        pending = null
        sendFrame(queued)
      }
      return
    }
    if (message.type === 'input') {
      const input = parseBrowserInputEvent(message.event)
      if (!input) {
        socket.close(4003, 'Invalid browser input event')
        return
      }
      if (inputQueue.length + (dispatching ? 1 : 0) >= maxQueuedInput) {
        socket.close(4008, 'Input backlog exceeded')
        return
      }
      inputQueue.push(input)
      dispatchInput()
    }
  })
  socket.on('close', () => {
    closed = true
    if (ackTimer !== undefined) clearTimeout(ackTimer)
    pending = null
    inputQueue = []
    unsubscribe()
    session.releaseViewer()
  })
  socket.on('error', () => {
    socket.close()
  })

  const heartbeat = setInterval(() => sendJson({ type: 'heartbeat' }), heartbeatIntervalMs)
  heartbeat.unref?.()
  const ping = setInterval(() => {
    if (!closed) socket.ping()
  }, pingIntervalMs)
  ping.unref?.()
  socket.on('close', () => {
    clearInterval(heartbeat)
    clearInterval(ping)
  })

  const status = session.status()
  sendJson({ type: 'status', status })
  if (status.url) sendJson({ type: 'url', url: status.url })
  const cached = session.currentFrame()
  if (cached) sendFrame(cached)
}
