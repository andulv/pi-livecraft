import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { BrowserInputEvent, BrowserSessionStatus } from '../shared/types.ts'
import type { BrowserSessionEvent } from '../server/features/browser/browser-session.ts'
import {
  attachViewerSocket,
  type ViewerSession,
  type ViewerSocket,
} from '../server/features/browser/viewer-socket.ts'

class FakeSocket extends EventEmitter implements ViewerSocket {
  readonly sent: Array<{ data: string | Buffer; binary: boolean }> = []
  closedWith: number | undefined
  pingCount = 0

  send(data: string | Buffer, options?: { binary?: boolean }): void {
    this.sent.push({ data, binary: options?.binary === true })
  }

  close(code?: number): void {
    this.closedWith = code
    this.emit('close')
  }

  // The message listener is registered for string data only.
  receive(value: unknown): void {
    this.emit('message', JSON.stringify(value))
  }

  ping(): void {
    this.pingCount += 1
  }
}

function fakeSession(): ViewerSession & {
  emitEvent: (event: BrowserSessionEvent) => void
  input: BrowserInputEvent[]
  viewers: () => number
  releaseDispatch: () => void
} {
  const listeners = new Set<(event: BrowserSessionEvent) => void>()
  const input: BrowserInputEvent[] = []
  const dispatchWaiters: Array<() => void> = []
  let viewers = 0
  const status: BrowserSessionStatus = {
    state: 'live',
    url: 'https://example.dev',
    endpoint: 'http://127.0.0.1:9222',
    error: undefined,
    viewport: { width: 1280, height: 900, mobile: false },
  }
  return {
    status: () => status,
    currentFrame: () => undefined,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    addViewer: () => {
      viewers += 1
    },
    releaseViewer: () => {
      viewers -= 1
    },
    dispatchInput(event) {
      input.push(event)
      return new Promise<void>((resolve) => {
        dispatchWaiters.push(resolve)
      })
    },
    releaseDispatch: async () => {
      while (dispatchWaiters.length > 0) {
        dispatchWaiters.shift()?.()
        // Let the dispatch chain's finally pick up the next queued event.
        await Promise.resolve()
        await Promise.resolve()
      }
    },
    emitEvent: (event) => {
      for (const listener of listeners) listener(event)
    },
    input,
    viewers: () => viewers,
  }
}

const fastOptions = { ackTimeoutMs: 10_000, heartbeatIntervalMs: 60_000, pingIntervalMs: 60_000 }

function sentFrames(socket: FakeSocket): Buffer[] {
  return socket.sent.filter(({ binary }) => binary).map(({ data }) => data as Buffer)
}

function sentControls(socket: FakeSocket): unknown[] {
  return socket.sent.filter(({ binary }) => !binary).map(({ data }) => JSON.parse(String(data)))
}

test('sends the cached frame through credit accounting and status on attach', () => {
  const session = fakeSession()
  const socket = new FakeSocket()
  attachViewerSocket(socket, session, fastOptions)
  assert.deepEqual(sentControls(socket).map((value) => (value as { type: string }).type), [
    'status',
    'url',
  ])
  assert.equal(session.viewers(), 1)

  const frame = Buffer.from([1, 2, 3])
  session.emitEvent({ type: 'frame', buffer: frame })
  assert.deepEqual(sentFrames(socket), [frame])

  socket.close()
  assert.equal(session.viewers(), 0)
})

test('retains only the newest frame while one is outstanding, flushed by the ack', () => {
  const session = fakeSession()
  const socket = new FakeSocket()
  attachViewerSocket(socket, session, fastOptions)

  session.emitEvent({ type: 'frame', buffer: Buffer.from([1]) })
  session.emitEvent({ type: 'frame', buffer: Buffer.from([2]) })
  session.emitEvent({ type: 'frame', buffer: Buffer.from([3]) })
  assert.deepEqual(sentFrames(socket), [Buffer.from([1])])

  socket.receive({ type: 'frameAck' })
  assert.deepEqual(sentFrames(socket), [Buffer.from([1]), Buffer.from([3])])

  // A static page's last frame still arrives: ack with nothing pending just restores credit.
  socket.receive({ type: 'frameAck' })
  session.emitEvent({ type: 'frame', buffer: Buffer.from([4]) })
  assert.deepEqual(sentFrames(socket), [Buffer.from([1]), Buffer.from([3]), Buffer.from([4])])
})

test('ignores acknowledgements with nothing outstanding', () => {
  const session = fakeSession()
  const socket = new FakeSocket()
  attachViewerSocket(socket, session, fastOptions)
  socket.receive({ type: 'frameAck' })
  socket.receive({ type: 'frameAck' })
  assert.deepEqual(sentFrames(socket), [])

  session.emitEvent({ type: 'frame', buffer: Buffer.from([9]) })
  socket.receive({ type: 'frameAck' })
  socket.receive({ type: 'frameAck' })
  session.emitEvent({ type: 'frame', buffer: Buffer.from([8]) })
  // The duplicate ack must not have granted a second credit: frames stayed ordered.
  assert.deepEqual(sentFrames(socket), [Buffer.from([9]), Buffer.from([8])])
})

test('closes the viewer when a frame is not acknowledged', async () => {
  const session = fakeSession()
  const socket = new FakeSocket()
  attachViewerSocket(socket, session, { ...fastOptions, ackTimeoutMs: 20 })
  session.emitEvent({ type: 'frame', buffer: Buffer.from([1]) })
  session.emitEvent({ type: 'frame', buffer: Buffer.from([2]) })

  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(socket.closedWith, 4004)
  assert.deepEqual(sentFrames(socket), [Buffer.from([1])])
  // No further frames after the timeout, and the viewer was released.
  session.emitEvent({ type: 'frame', buffer: Buffer.from([3]) })
  assert.equal(sentFrames(socket).length, 1)
  assert.equal(session.viewers(), 0)
})

test('drops the pending frame when the viewport changes', () => {
  const session = fakeSession()
  const socket = new FakeSocket()
  attachViewerSocket(socket, session, fastOptions)
  session.emitEvent({ type: 'frame', buffer: Buffer.from([1]) })
  session.emitEvent({ type: 'frame', buffer: Buffer.from([2]) })
  session.emitEvent({ type: 'viewport' })
  socket.receive({ type: 'frameAck' })
  assert.deepEqual(sentFrames(socket), [Buffer.from([1])])
})

test('dispatches input in order, rejects invalid events, and bounds the backlog', async () => {
  const session = fakeSession()
  const socket = new FakeSocket()
  attachViewerSocket(socket, session, { ...fastOptions, maxQueuedInput: 3 })

  const move = (x: number): BrowserInputEvent => ({
    type: 'mouseMoved',
    x,
    y: 0,
    button: 'none',
    clickCount: 0,
    modifiers: 0,
  })
  socket.receive({ type: 'input', event: move(1) })
  socket.receive({
    type: 'input',
    event: { type: 'keyDown', key: 'a', code: 'KeyA', keyCode: 65, modifiers: 0 },
  })
  socket.receive({ type: 'input', event: move(3) })
  session.releaseDispatch()
  await new Promise((resolve) => setImmediate(resolve))
  const labels = session.input.map((event) =>
    event.type === 'mouseMoved' ? String(event.x) : event.type
  )
  assert.deepEqual(labels, ['1', 'keyDown', '3'])

  // Slow CDP: the in-flight dispatch plus the queued backlog reaches the bound.
  socket.receive({ type: 'input', event: move(4) })
  socket.receive({ type: 'input', event: move(5) })
  socket.receive({ type: 'input', event: move(6) })
  socket.receive({ type: 'input', event: move(7) })
  assert.equal(socket.closedWith, 4008)
  session.releaseDispatch()

  socket.receive({ type: 'input', event: { type: 'bogus' } })
  const fresh = new FakeSocket()
  attachViewerSocket(fresh, fakeSession(), { ...fastOptions })
  fresh.receive({ type: 'input', event: { type: 'bogus' } })
  assert.equal(fresh.closedWith, 4003)
})
