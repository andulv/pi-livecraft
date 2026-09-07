import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceEventSequence } from '../src/features/conversation/event-sequence.ts'
import { mergeSnapshotResponse } from '../src/features/conversation/snapshot-merge.ts'
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
  assert.equal(gate.schedule('session-a'), 'run')
  assert.equal(gate.followUp('session-a', true), false)
  assert.equal(gate.visibilityChanged(false, 'session-a'), undefined)
})

test('defers hidden automatic snapshots and starts one catch-up on return', () => {
  const gate = new SnapshotGate(true)
  assert.equal(gate.schedule('session-a'), 'deferred')
  assert.equal(gate.schedule('session-a'), 'deferred')
  assert.equal(gate.followUp('session-a', true), true)
  assert.equal(gate.visibilityChanged(false, 'session-a'), 'run')
  assert.equal(gate.visibilityChanged(false, 'session-a'), undefined)
})

test('drops deferred work for a session that is no longer selected', () => {
  const gate = new SnapshotGate(true)
  assert.equal(gate.schedule('session-a'), 'deferred')
  gate.selectionChanged()
  assert.equal(gate.visibilityChanged(false, 'session-b'), undefined)
})

test('stays hidden through a visibility report that keeps the page hidden', () => {
  const gate = new SnapshotGate(true)
  assert.equal(gate.schedule('session-a'), 'deferred')
  assert.equal(gate.visibilityChanged(true, 'session-a'), undefined)
  assert.equal(gate.schedule('session-a'), 'deferred')
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
