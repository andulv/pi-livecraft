import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSseLastEventId } from '../server/sse-response.ts'
import {
  parseTerminalId,
  parseTerminalInput,
  parseTerminalResize,
  TerminalChunkBuffer,
  TerminalSession,
  wireOutputChunk,
  WatermarkGate,
  type TerminalPty,
  type TerminalSubscription,
} from '../server/features/terminal/session.ts'

test('validates terminal ids, input payloads, and resize bounds', () => {
  assert.equal(parseTerminalId('main'), 'main')
  assert.equal(parseTerminalId('ab-_09'), 'ab-_09')
  assert.equal(parseTerminalId(''), null)
  assert.equal(parseTerminalId('-lead'), null)
  assert.equal(parseTerminalId('x'.repeat(65)), null)

  assert.equal(parseTerminalInput({ data: 'ls -la\r' }), 'ls -la\r')
  assert.equal(parseTerminalInput({ data: '' }), null)
  assert.equal(parseTerminalInput({ data: 'x'.repeat(10_001) }), null)
  assert.equal(parseTerminalInput({ data: 42 }), null)
  assert.equal(parseTerminalInput('nonsense'), null)

  assert.deepEqual(parseTerminalResize({ cols: 120, rows: 40 }), { cols: 120, rows: 40 })
  assert.equal(parseTerminalResize({ cols: 0, rows: 24 }), null)
  assert.equal(parseTerminalResize({ cols: 1001, rows: 24 }), null)
  assert.equal(parseTerminalResize({ cols: 80.5, rows: 24 }), null)
  assert.equal(parseTerminalResize({ cols: '80', rows: 24 }), null)
})

test('chunks carry cumulative offsets and resume from exclusive ids', () => {
  const buffer = new TerminalChunkBuffer()
  const first = buffer.push(Buffer.from('hello '))
  const second = buffer.push(Buffer.from('world'))
  assert.equal(first.start, 0)
  assert.equal(second.start, 6)
  assert.equal(buffer.endOffset, 11)

  // A fresh subscriber gets everything; a reconnect resumes past its last id.
  assert.deepEqual(buffer.resumeAfter(undefined).map((chunk) => chunk.start), [0, 6])
  assert.deepEqual(buffer.resumeAfter(6).map((chunk) => chunk.start), [6])
  assert.deepEqual(buffer.resumeAfter(3).map((chunk) => chunk.start), [0, 6])
  assert.deepEqual(buffer.resumeAfter(11), [])
  assert.deepEqual(buffer.resumeAfter(999), [])
})

test('the ring buffer drops whole oldest chunks and stays bounded', () => {
  const buffer = new TerminalChunkBuffer(100)
  for (let index = 0; index < 20; index++) {
    buffer.push(Buffer.alloc(20, index))
  }
  // A whole chunk drops at a time; a single oversized chunk is kept whole.
  assert.ok(buffer.totalBytes <= 120, `bounded, was ${buffer.totalBytes}`)
  assert.ok(buffer.totalBytes > 80, 'keeps the newest chunk even over target')
})

test('wire output serializes base64 once with the chunk-end id', () => {
  const wired = wireOutputChunk({ start: 2, bytes: Buffer.from('hi') })
  assert.equal(wired.id, 4)
  assert.deepEqual(JSON.parse(wired.json), { data: Buffer.from('hi').toString('base64') })
})

test('last-event-id parsing accepts only non-negative safe integers', () => {
  assert.equal(parseSseLastEventId('17'), 17)
  assert.equal(parseSseLastEventId('0'), 0)
  assert.equal(parseSseLastEventId(''), undefined)
  assert.equal(parseSseLastEventId('-1'), undefined)
  assert.equal(parseSseLastEventId('2.5'), undefined)
  assert.equal(parseSseLastEventId('abc'), undefined)
  assert.equal(parseSseLastEventId(undefined), undefined)
})

test('the watermark gate pauses past high and resumes below low', () => {
  const gate = new WatermarkGate(100, 40)
  assert.equal(gate.noteProduced(60), null)
  assert.equal(gate.noteProduced(60), 'pause')
  assert.equal(gate.noteFlushed(70), null) // 50 pending: above low
  assert.equal(gate.noteFlushed(20), 'resume') // 30 pending: below low
  assert.equal(gate.paused, false)
})

test('the watermark gate blocks on congested subscribers until drained', () => {
  const gate = new WatermarkGate(100, 40)
  assert.equal(gate.noteProduced(60), null)
  assert.equal(gate.noteBlocked(), 'pause')
  assert.equal(gate.noteUnblocked(), null) // 60 pending: above low, stays paused
  assert.equal(gate.noteFlushed(30), 'resume') // 30 pending: below low
})

class FakePty implements TerminalPty {
  readonly process = 'fake-shell'
  paused = false
  killed = false
  written: string[] = []
  resized: Array<[number, number]> = []
  readonly #dataListeners = new Set<(data: string) => void>()
  readonly #exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()

  write(data: string): void {
    this.written.push(data)
  }

  resize(columns: number, rows: number): void {
    this.resized.push([columns, rows])
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  kill(): void {
    this.killed = true
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.#dataListeners.add(listener)
    return { dispose: () => this.#dataListeners.delete(listener) }
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void
  } {
    this.#exitListeners.add(listener)
    return { dispose: () => this.#exitListeners.delete(listener) }
  }

  emitData(data: string): void {
    for (const listener of [...this.#dataListeners]) listener(data)
  }

  emitExit(event: { exitCode: number; signal?: number }): void {
    for (const listener of [...this.#exitListeners]) listener(event)
  }
}

function sessionWithFake(): { pty: FakePty; session: TerminalSession } {
  const pty = new FakePty()
  const session = new TerminalSession({
    workspacePath: '/tmp/demo',
    spawnPty: () => pty,
  })
  return { pty, session }
}

function collect(): {
  outputs: Array<{ json: string; id?: number }>
  statuses: string[]
  subscription: (session: TerminalSession) => TerminalSubscription
} {
  const outputs: Array<{ json: string; id?: number }> = []
  const statuses: string[] = []
  return {
    outputs,
    statuses,
    subscription: (session) =>
      session.subscribe((event, json, id) => {
        if (event === 'output') outputs.push({ json, id })
        else statuses.push(json)
      }),
  }
}

test('a session starts, forwards write and resize, and reports live', async () => {
  const { pty, session } = sessionWithFake()
  const start = session.start()
  const status = await start
  assert.equal(status.state, 'live')
  assert.equal(status.shell, 'fake-shell')
  assert.equal(pty.process, 'fake-shell')

  session.write('echo hi\r')
  assert.deepEqual(pty.written, ['echo hi\r'])

  session.resize(100, 30)
  assert.deepEqual(pty.resized, [[100, 30]])
  assert.equal(session.status().cols, 100)
  assert.equal(session.status().rows, 30)

  // Concurrent and repeated starts are idempotent while live.
  assert.deepEqual(await session.start(), await session.start())
})

test('output chunks reach subscribers once with increasing ids', async () => {
  const { pty, session } = sessionWithFake()
  await session.start()
  const collected = collect()
  collected.subscription(session)

  pty.emitData('hello ')
  pty.emitData('world')
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.equal(collected.outputs.length, 1, 'bursts coalesce into one chunk')
  assert.equal(collected.outputs[0]?.id, 11)
  assert.deepEqual(
    JSON.parse(collected.outputs[0]?.json ?? '{}'),
    { data: Buffer.from('hello world').toString('base64') },
  )
})

test('congestion pauses the PTY and drain resumes it', async () => {
  const { pty, session } = sessionWithFake()
  await session.start()
  const collected = collect()
  const subscription = collected.subscription(session)

  subscription.setCongested(true)
  assert.equal(pty.paused, true)
  subscription.setCongested(false)
  assert.equal(pty.paused, false)

  // Unsubscribe while congested must not leak the block.
  subscription.setCongested(true)
  assert.equal(pty.paused, true)
  subscription.unsubscribe()
  assert.equal(pty.paused, false)
})

test('exit marks the session ended and a restart spawns a fresh epoch', async () => {
  const { pty, session } = sessionWithFake()
  await session.start()
  pty.emitData('stale output')
  await new Promise((resolve) => setTimeout(resolve, 30))
  pty.emitExit({ exitCode: 0 })
  assert.equal(session.status().state, 'exited')

  const start = session.start()
  assert.equal((await start).state, 'live')
  const replayed = session.replay()
  assert.deepEqual(replayed.filter((item) => item.name === 'output'), [])
  assert.equal(replayed[0]?.name, 'status')
})

test('a signal kill is reported as crashed; signal 0 is a normal exit; stop is off', async () => {
  const { pty, session } = sessionWithFake()
  await session.start()
  pty.emitExit({ exitCode: 1, signal: 9 })
  assert.equal(session.status().state, 'crashed')
  assert.match(session.status().error ?? '', /signal 9/)

  await session.start()
  pty.emitExit({ exitCode: 0, signal: 0 })
  assert.equal(session.status().state, 'exited')

  await session.start()
  session.stop()
  assert.equal(session.status().state, 'off')
  assert.equal(pty.killed, true)
  session.stop()
})

test('replay sends status first, then chunks after the resume offset', async () => {
  const { pty, session } = sessionWithFake()
  await session.start()
  pty.emitData('abcdef')
  await new Promise((resolve) => setTimeout(resolve, 30))
  pty.emitData('ghijkl')
  await new Promise((resolve) => setTimeout(resolve, 30))

  const full = session.replay()
  assert.deepEqual(full.map((item) => item.name), ['status', 'output', 'output'])
  assert.deepEqual(full.map((item) => item.id), [undefined, 6, 12])

  const resumed = session.replay(6)
  assert.deepEqual(resumed.map((item) => item.id), [undefined, 12])
})
