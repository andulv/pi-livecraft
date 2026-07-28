import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceEventSequence } from '../src/features/conversation/event-sequence.ts'

test('accepts live events once while leaving unsequenced events untouched', () => {
  assert.equal(advanceEventSequence(4, 5), 5)
  assert.equal(advanceEventSequence(5, 5), null)
  assert.equal(advanceEventSequence(5, 3), null)
  assert.equal(advanceEventSequence(5), 5)
})
