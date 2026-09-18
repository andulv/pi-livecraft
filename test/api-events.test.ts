import assert from 'node:assert/strict'
import test from 'node:test'
import { parseManagerEvent, subscribeBrowserEvents, subscribeManagerEvents } from '../src/api.ts'

test('parses a valid manager event', () => {
  const event = parseManagerEvent(JSON.stringify({
    kind: 'event',
    event: 'pi',
    sessionId: 'session-1',
    data: { type: 'agent_start' },
    sequence: 3,
  }))

  assert.deepEqual(event, {
    kind: 'event',
    event: 'pi',
    sessionId: 'session-1',
    data: { type: 'agent_start' },
    sequence: 3,
  })
  assert.deepEqual(
    parseManagerEvent(JSON.stringify({
      kind: 'event',
      event: 'session_reassigned',
      sessionId: 'session-1',
      data: { newSessionId: 'session-2' },
    })),
    {
      kind: 'event',
      event: 'session_reassigned',
      sessionId: 'session-1',
      data: { newSessionId: 'session-2' },
    },
  )
})

test('reports one manager stream drop and its recovery per outage', async () => {
  class FakeEventSource {
    static latest: FakeEventSource | undefined
    onmessage: ((event: MessageEvent) => void) | null = null
    onopen: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    closed = false
    readonly url: string

    constructor(url: string) {
      this.url = url
      FakeEventSource.latest = this
    }

    close(): void {
      this.closed = true
    }
  }

  const originalEventSource = globalThis.EventSource
  const originalFetch = globalThis.fetch
  const logs: Array<{ source: string; message: string }> = []
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  globalThis.fetch = (async (_input, init) => {
    logs.push(JSON.parse(String(init?.body)))
    return new Response(null, { status: 202 })
  }) as typeof fetch

  try {
    let errors = 0
    let opens = 0
    const unsubscribe = subscribeManagerEvents(
      () => undefined,
      () => errors += 1,
      () => opens += 1,
    )
    const source = FakeEventSource.latest!

    source.onopen?.(new Event('open'))
    assert.equal(opens, 1)
    assert.equal(logs.length, 0)

    source.onerror?.(new Event('error'))
    source.onerror?.(new Event('error'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(errors, 1)
    assert.deepEqual(logs, [{ source: 'sse-drop', message: 'manager event stream error' }])

    source.onopen?.(new Event('open'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(opens, 2)
    assert.equal(logs[1]?.source, 'sse-reopen')
    assert.match(logs[1]?.message ?? '', /^manager event stream recovered after \d+ ms$/)

    source.onerror?.(new Event('error'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(errors, 2)
    assert.equal(logs[2]?.source, 'sse-drop')

    unsubscribe()
    assert.equal(source.closed, true)
    assert.equal(source.url, '/api/events')
  } finally {
    globalThis.EventSource = originalEventSource
    globalThis.fetch = originalFetch
  }
})

test('marks browser stream errors stale without automatic reconnect', async () => {
  type Listener = (event: { data?: unknown }) => void
  class FakeEventSource {
    static latest: FakeEventSource | undefined
    static instances = 0
    onerror: ((event: Event) => void) | null = null
    closed = false
    readonly listeners = new Map<string, Listener[]>()
    readonly url: string

    constructor(url: string) {
      this.url = url
      FakeEventSource.latest = this
      FakeEventSource.instances++
    }

    addEventListener(name: string, listener: Listener): void {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
    }

    emit(name: string, data: unknown): void {
      for (const listener of this.listeners.get(name) ?? []) {
        listener({ data: JSON.stringify(data) })
      }
    }

    close(): void {
      this.closed = true
    }
  }

  const originalEventSource = globalThis.EventSource
  const originalFetch = globalThis.fetch
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  globalThis.fetch = (async () => new Response(null, { status: 202 })) as typeof fetch

  try {
    const states: string[] = []
    const unsubscribe = subscribeBrowserEvents(
      { browserId: 'main', workspacePath: '/workspace' },
      { onStreamState: (state) => states.push(state) },
    )
    const source = FakeEventSource.latest!
    assert.deepEqual(states, ['connecting'])

    source.emit('heartbeat', {})
    assert.deepEqual(states, ['connecting', 'connected'])

    source.onerror?.(new Event('error'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.deepEqual(states, ['connecting', 'connected', 'stale'])
    assert.equal(source.closed, true)
    assert.equal(FakeEventSource.instances, 1)

    unsubscribe()
    assert.equal(source.url, '/api/browser/instances/main/frames?workspacePath=%2Fworkspace')
  } finally {
    globalThis.EventSource = originalEventSource
    globalThis.fetch = originalFetch
  }
})

test('rejects malformed or unknown manager events', () => {
  assert.equal(parseManagerEvent('{'), null)
  assert.equal(
    parseManagerEvent(JSON.stringify({ kind: 'response', event: 'pi', sessionId: 'session-1' })),
    null,
  )
  assert.equal(
    parseManagerEvent(JSON.stringify({ kind: 'event', event: 'unknown', sessionId: 'session-1' })),
    null,
  )
  assert.equal(
    parseManagerEvent(JSON
      .stringify({ kind: 'event', event: 'pi', sessionId: 'session-1', sequence: -1 })),
    null,
  )
})
