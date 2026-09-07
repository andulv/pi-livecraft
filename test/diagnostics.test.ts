import assert from 'node:assert/strict'
import test from 'node:test'
import { DiagnosticsRecorder } from '../server/features/diagnostics/diagnostics.ts'

test('counts requests per route and records bounded recent events', () => {
  const diagnostics = new DiagnosticsRecorder()
  for (let index = 0; index < 150; index++) diagnostics.request('git')

  const state = diagnostics.snapshotState()
  assert.equal(state.requests.git, 150)
  // The payload serializes the newest slice of the ring, not the whole ring.
  assert.equal(state.recentEvents.length, 30)
  assert.equal(state.recentEvents[0]?.sequence, 121)
  assert.equal(state.recentEvents.at(-1)?.route, 'git')
  const sequences = state.recentEvents.map(({ sequence }) => sequence)
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b))
})

test('counts errors and SSE openings separately from requests', () => {
  const diagnostics = new DiagnosticsRecorder()
  diagnostics.request('sessions')
  diagnostics.error('sessions/:id/snapshot')
  diagnostics.sseOpen()

  diagnostics.cacheHit()
  diagnostics.cacheMiss()
  const state = diagnostics.snapshotState()
  assert.equal(state.errors, 1)
  assert.equal(state.sseOpens, 1)
  assert.deepEqual(state.cache, { hits: 1, misses: 1 })
  assert.equal(state.requests.sessions, 1)
  assert.ok(state.recentEvents.some((event) => event.kind === 'error' && !event.ok))
})

test('accumulates snapshot totals and bounds the stage ring', () => {
  const diagnostics = new DiagnosticsRecorder()
  for (let index = 0; index < 60; index++) {
    diagnostics.snapshot({
      rpcMs: 10,
      buildMs: 2,
      templatesMs: 1,
      totalMs: 13,
      bytes: 1000,
      mode: index % 2 === 0 ? 'full' : 'delta',
    })
  }

  const state = diagnostics.snapshotState()
  assert.equal(state.snapshots.full, 30)
  assert.equal(state.snapshots.delta, 30)
  assert.equal(state.snapshots.fullBytes, 30_000)
  assert.equal(state.snapshots.deltaBytes, 30_000)
  assert.equal(state.recentStages.length, 20)
  // Events and stages share one monotonic sequence counter, so stage 41 of 60
  // carries sequence 2*41-1.
  assert.equal(state.recentStages[0]?.sequence, 81)
  assert.equal(state.recentStages.at(-1)?.mode, 'delta')
  assert.ok(state.recentEvents.some((event) => event.kind === 'snapshot' && event.mode === 'full'))
})

test('keeps entries content-free', () => {
  const allowedEventKeys = ['sequence', 't', 'kind', 'route', 'durationMs', 'bytes', 'mode', 'ok']
  const diagnostics = new DiagnosticsRecorder()
  diagnostics.request('sessions/recent')
  diagnostics.snapshot({
    rpcMs: 10,
    buildMs: 2,
    templatesMs: 1,
    totalMs: 13,
    bytes: 1000,
    mode: 'delta',
  })

  const state = diagnostics.snapshotState()
  for (const event of state.recentEvents) {
    assert.deepEqual(Object.keys(event).filter((key) => !allowedEventKeys.includes(key)), [])
  }
  for (const stage of state.recentStages) {
    assert.ok(!('session' in stage) && !('payload' in stage))
  }
  assert.ok(state.uptimeMs >= 0)
})
