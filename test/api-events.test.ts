import assert from 'node:assert/strict'
import test from 'node:test'
import {
  managerEventStreamState,
  parseManagerEvent,
  sendBrowserInput,
  subscribeBrowserEvents,
  subscribeManagerEvents,
  subscribeTerminalOutput,
  sendTerminalInput,
} from '../src/api.ts'

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
    readyState = 0
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
    const events: string[] = []
    const unsubscribe = subscribeManagerEvents(
      (event) => events.push(event.event),
      () => errors += 1,
      () => opens += 1,
      () => false,
    )
    const source = FakeEventSource.latest!

    assert.equal(managerEventStreamState(), 'connecting')
    source.readyState = 1
    source.onopen?.(new Event('open'))
    assert.equal(managerEventStreamState(), 'open')
    assert.equal(opens, 1)
    assert.equal(logs.length, 0)

    source.readyState = 0
    source.onerror?.(new Event('error'))
    source.onerror?.(new Event('error'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(errors, 1)
    assert.equal(logs[0]?.source, 'sse-drop')
    assert.match(
      logs[0]?.message ?? '',
      /^view=[a-f0-9]{8} manager event stream error; silenceMs=none; hidden=false; state=connecting; streams=e\d\/f\d\/t\d; pending=\d+; oldestPendingMs=\d+$/,
    )

    source.readyState = 1
    source.onopen?.(new Event('open'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(opens, 2)
    assert.equal(logs[1]?.source, 'sse-reopen')
    assert.match(
      logs[1]?.message ?? '',
      /^view=[a-f0-9]{8} manager event stream recovered after \d+ ms; silenceMs=none; hidden=false; state=open; streams=e\d\/f\d\/t\d; pending=\d+; oldestPendingMs=\d+$/,
    )
    source.onmessage?.({
      data: JSON.stringify({ kind: 'event', event: 'manager_connected', sessionId: '' }),
    } as MessageEvent)
    assert.deepEqual(events, ['manager_connected'])

    source.readyState = 0
    source.onerror?.(new Event('error'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(errors, 2)
    assert.equal(logs[2]?.source, 'sse-drop')
    assert.match(
      logs[2]?.message ?? '',
      /silenceMs=\d+; hidden=false; state=connecting; streams=e\d\/f\d\/t\d; pending=\d+; oldestPendingMs=\d+$/,
    )
    assert.equal(logs[0]?.message.slice(0, 13), logs[2]?.message.slice(0, 13))

    source.readyState = 2
    assert.equal(managerEventStreamState(), 'closed')
    unsubscribe()
    assert.equal(managerEventStreamState(), 'none')
    assert.equal(source.closed, true)
    assert.equal(source.url, '/api/events')
  } finally {
    globalThis.EventSource = originalEventSource
    globalThis.fetch = originalFetch
  }
})

test('reopens a closed manager stream and cancels a pending reopen on unsubscribe', async () => {
  class FakeEventSource {
    static readonly CLOSED = 2
    static readonly instances: FakeEventSource[] = []
    onmessage: ((event: MessageEvent) => void) | null = null
    onopen: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    readyState = 0
    closed = false
    readonly url: string

    constructor(url: string) {
      this.url = url
      FakeEventSource.instances.push(this)
    }

    close(): void {
      this.closed = true
      this.readyState = 2
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

  let unsubscribe: (() => void) | undefined
  try {
    const events: string[] = []
    let errors = 0
    unsubscribe = subscribeManagerEvents(
      (event) => events.push(event.event),
      () => errors++,
    )
    const first = FakeEventSource.instances[0]!
    first.readyState = 1
    first.onopen?.(new Event('open'))
    first.readyState = 2
    first.onerror?.(new Event('error'))
    assert.equal(errors, 1)
    assert.equal(managerEventStreamState(), 'closed')
    assert.equal(FakeEventSource.instances.length, 1)

    await new Promise((resolve) => setTimeout(resolve, 550))
    const second = FakeEventSource.instances[1]!
    assert.equal(first.closed, true)
    assert.equal(second.url, '/api/events')
    assert.equal(managerEventStreamState(), 'connecting')
    second.readyState = 1
    second.onopen?.(new Event('open'))
    second.onmessage?.({
      data: JSON.stringify({ kind: 'event', event: 'manager_connected', sessionId: '' }),
    } as MessageEvent)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.deepEqual(events, ['manager_connected'])
    assert.deepEqual(logs.map((entry) => entry.source), ['sse-drop', 'sse-reopen'])
    assert.match(
      logs[0]!.message,
      /state=closed; streams=e\d\/f\d\/t\d; pending=\d+; oldestPendingMs=\d+$/,
    )
    assert.match(
      logs[1]!.message,
      /state=open; streams=e\d\/f\d\/t\d; pending=\d+; oldestPendingMs=\d+$/,
    )

    second.readyState = 2
    second.onerror?.(new Event('error'))
    unsubscribe()
    unsubscribe = undefined
    await new Promise((resolve) => setTimeout(resolve, 550))
    assert.equal(FakeEventSource.instances.length, 2)
    assert.equal(second.closed, true)
    assert.equal(managerEventStreamState(), 'none')
  } finally {
    unsubscribe?.()
    globalThis.EventSource = originalEventSource
    globalThis.fetch = originalFetch
  }
})

test('browser viewer socket streams status, forwards input, and reports closes', async () => {
  class FakeWebSocket {
    static latest: FakeWebSocket | undefined
    readyState = 0
    binaryType = 'blob'
    onopen: (() => void) | null = null
    onclose: ((event: { code: number }) => void) | null = null
    onmessage: ((event: { data: unknown }) => void) | null = null
    readonly sent: string[] = []
    readonly url: string

    constructor(url: string) {
      this.url = url
      FakeWebSocket.latest = this
    }

    send(data: string): void {
      this.sent.push(data)
    }

    close(): void {
      this.readyState = 3
      this.onclose?.({ code: 1006 })
    }
  }

  const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket
  const originalLocation = (globalThis as { location?: unknown }).location
  const originalFetch = globalThis.fetch
  const logs: Array<{ source: string; message: string }> = []
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket
  ;(globalThis as { location?: unknown }).location = {
    protocol: 'http:',
    host: '127.0.0.1:5173',
  }
  globalThis.fetch = (async (_input, init) => {
    logs.push(JSON.parse(String(init?.body)))
    return new Response(null, { status: 202 })
  }) as typeof fetch

  try {
    const statuses: string[] = []
    const target = { browserId: 'main', workspacePath: '/workspace' }
    const unsubscribe = subscribeBrowserEvents(target, {
      onStatus: (status) => statuses.push(status.state),
    })
    const ws = FakeWebSocket.latest!
    assert.equal(
      ws.url,
      'ws://127.0.0.1:5173/api/browser/instances/main/socket?workspacePath=%2Fworkspace',
    )

    ws.readyState = 1
    ws.onopen?.()
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', status: { state: 'live' } }) })
    assert.deepEqual(statuses, ['live'])

    sendBrowserInput(target, { type: 'insertText', text: 'hi' })
    assert.deepEqual(ws.sent, ['{"type":"input","event":{"type":"insertText","text":"hi"}}'])

    ws.close()
    await new Promise<void>((resolve) => setImmediate(resolve))
    const drops = logs.filter(({ source }) => source === 'sse-drop')
    assert.equal(drops.length, 1)
    assert.match(drops[0]!.message, /browser socket closed \(code 1006\); streams=/)

    // Input after a close is dropped, and unsubscribing cancels the scheduled reconnect.
    sendBrowserInput(target, { type: 'insertText', text: 'dropped' })
    assert.equal(ws.sent.length, 1)
    unsubscribe()
  } finally {
    ;(globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket
    ;(globalThis as { location?: unknown }).location = originalLocation
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

test('terminal viewer socket resumes from the last id and buffers input while closed', async () => {
  class FakeWebSocket {
    static latest: FakeWebSocket | undefined
    readyState = 0
    binaryType = 'blob'
    onopen: (() => void) | null = null
    onclose: ((event: { code: number }) => void) | null = null
    onmessage: ((event: { data: unknown }) => void) | null = null
    readonly sent: string[] = []
    readonly url: string

    constructor(url: string) {
      this.url = url
      FakeWebSocket.latest = this
    }

    send(data: string): void {
      this.sent.push(data)
    }

    close(): void {
      this.readyState = 3
      this.onclose?.({ code: 1000 })
    }
  }

  const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket
  const originalLocation = (globalThis as { location?: unknown }).location
  const originalFetch = globalThis.fetch
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket
  ;(globalThis as { location?: unknown }).location = {
    protocol: 'http:',
    host: '127.0.0.1:5173',
  }
  globalThis.fetch = (async () => new Response(null, { status: 202 })) as typeof fetch

  try {
    const outputs: string[] = []
    const target = { terminalId: 'main', workspacePath: '/workspace' }
    const unsubscribe = subscribeTerminalOutput(target, {
      onOutput: (base64) => outputs.push(base64),
      onStatus: () => undefined,
    })

    // Reopen after a seen id resumes from the exclusive offset.
    const first = FakeWebSocket.latest!
    assert.equal(
      first.url,
      'ws://127.0.0.1:5173/api/terminal/instances/main/socket?workspacePath=%2Fworkspace',
    )
    first.onmessage?.({
      data: JSON.stringify({ type: 'output', id: 41, data: 'aGk=' }),
    })
    assert.deepEqual(outputs, ['aGk='])

    first.close()
    await new Promise<void>((resolve) => setImmediate(resolve))
    // Input typed while reconnecting waits in the bounded queue.
    sendTerminalInput(target, 'ls\r')
    assert.deepEqual(first.sent, [])

    // The backoff-scheduled reopen creates a fresh socket that resumes from the last id.
    let second = FakeWebSocket.latest!
    const startedAt = Date.now()
    while (second === first && Date.now() - startedAt < 2000) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      second = FakeWebSocket.latest!
    }
    assert.notEqual(second, first)
    second.readyState = 1
    second.onopen?.()
    assert.deepEqual(JSON.parse(second.sent[0]!), { type: 'input', data: 'ls\r' })
    assert.match(
      second.url,
      /lastEventId=41$/,
      'the reconnect resumes after the last seen output id',
    )
    unsubscribe()
  } finally {
    ;(globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket
    ;(globalThis as { location?: unknown }).location = originalLocation
    globalThis.fetch = originalFetch
  }
})
