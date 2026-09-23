import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceEventSequence } from '../src/features/conversation/event-sequence.ts'
import { mergeSnapshotResponse } from '../src/features/conversation/snapshot-merge.ts'
import { reconciliationLogMessage } from '../src/features/conversation/reconciliation-log.ts'
import { SnapshotGate } from '../src/features/conversation/snapshot-gate.ts'
import type { SessionSnapshot, SessionSnapshotDelta } from '../shared/types.ts'

test('accepts live events once while leaving unsequenced events untouched', () => {
  assert.equal(advanceEventSequence(4, 5), 5)
  assert.equal(advanceEventSequence(5, 5), null)
  assert.equal(advanceEventSequence(5, 3), null)
  assert.equal(advanceEventSequence(5), 5)
})

test('runs automatic snapshots while the page is visible', () => {
  const gate = new SnapshotGate(false)
  assert.equal(gate.schedule(), 'run')
  assert.equal(gate.followUp(true), false)
  assert.equal(gate.visibilityChanged(false, 'session-a'), undefined)
})

test('defers hidden automatic snapshots and starts one catch-up on return', () => {
  const gate = new SnapshotGate(true)
  assert.equal(gate.schedule(), 'deferred')
  assert.equal(gate.schedule(), 'deferred')
  assert.equal(gate.followUp(true), true)
  assert.equal(gate.visibilityChanged(false, 'session-a'), 'run')
  assert.equal(gate.visibilityChanged(false, 'session-a'), undefined)
})

test('reconciles the selected session after hidden events were missed', () => {
  const gate = new SnapshotGate(false)
  assert.equal(gate.visibilityChanged(true, 'session-a'), undefined)
  assert.equal(gate.visibilityChanged(false, 'session-b'), 'run')
  assert.equal(gate.visibilityChanged(false, 'session-b'), undefined)
})

test('does not fetch on return without a selected session', () => {
  const gate = new SnapshotGate(true)
  assert.equal(gate.schedule(), 'deferred')
  assert.equal(gate.visibilityChanged(false, ''), undefined)
})

test('stays hidden through a visibility report that keeps the page hidden', () => {
  const gate = new SnapshotGate(true)
  assert.equal(gate.schedule(), 'deferred')
  assert.equal(gate.visibilityChanged(true, 'session-a'), undefined)
  assert.equal(gate.schedule(), 'deferred')
})

test('logs long or incomplete reconciliation but not a brief unchanged tab switch', () => {
  const short = {
    reason: 'visible' as const,
    outcome: 'applied' as const,
    hiddenMs: 1000,
    managerSilenceMs: 4000,
    piSilenceMs: 3000,
    hiddenPiEvents: 0,
    hiddenSettles: 0,
    durationMs: 200,
    mode: 'delta' as const,
    messages: 0,
    streaming: false,
  }
  assert.equal(reconciliationLogMessage(short), undefined)
  assert.match(
    reconciliationLogMessage({ ...short, messages: 2 }) ?? '',
    /hiddenPiEvents=0; hiddenSettles=0/,
  )
  assert.match(reconciliationLogMessage({ ...short, messages: 2 }) ?? '', /messages=2/)
  assert.match(reconciliationLogMessage({ ...short, hiddenMs: 12000 }) ?? '', /hiddenMs=12000/)
  assert.match(reconciliationLogMessage({ ...short, outcome: 'failed' }) ?? '', /outcome=failed/)
  assert.match(
    reconciliationLogMessage({ ...short, reason: 'reconnect' }) ?? '',
    /reason=reconnect/,
  )
})

const snapshotBase = {
  state: null,
  models: [],
  thinkingLevels: [],
  responseControls: null,
  commands: [],
  promptTemplates: [],
  stats: null,
  liveEvents: [],
}

test('delta responses append messages and keep identity when nothing changed', () => {
  const current: SessionSnapshot = {
    ...snapshotBase,
    messages: [{ role: 'user', content: 'Hi', entryId: 'm1' }],
    cursor: '1:m1',
  }
  const delta: SessionSnapshotDelta = {
    ...snapshotBase,
    mode: 'delta',
    appended: [{ role: 'assistant', content: [], entryId: 'm2' }],
    cursor: '2:m2',
  }

  const merged = mergeSnapshotResponse(current, delta)
  assert.equal(merged.messages.length, 2)
  assert.equal(merged.cursor, '2:m2')

  const settled = mergeSnapshotResponse(merged, { ...delta, appended: [] })
  assert.equal(settled.messages, merged.messages)
})

test('full responses replace the held snapshot unchanged', () => {
  const current: SessionSnapshot = {
    ...snapshotBase,
    messages: [{ role: 'user', content: 'Old', entryId: 'm0' }],
  }
  const full: SessionSnapshot = {
    ...snapshotBase,
    messages: [{ role: 'user', content: 'New', entryId: 'm1' }],
    cursor: '1:m1',
  }

  assert.equal(mergeSnapshotResponse(current, full), full)
})
