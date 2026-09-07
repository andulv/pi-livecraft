import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceEventSequence } from '../src/features/conversation/event-sequence.ts'
import { SnapshotGate } from '../src/features/conversation/snapshot-gate.ts'

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
