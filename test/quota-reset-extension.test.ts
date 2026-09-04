import assert from 'node:assert/strict'
import test from 'node:test'
import { isOpenAiResetConfirmed } from '../shared/quota-parsers.ts'

test('confirms an unrecognized OpenAI consume response only after the reset count falls', () => {
  assert.equal(
    isOpenAiResetConfirmed(2, { ok: true, data: [], resets: { availableCount: 1 } }),
    true,
  )
  assert.equal(
    isOpenAiResetConfirmed(2, { ok: true, data: [], resets: { availableCount: 2 } }),
    false,
  )
  assert.equal(isOpenAiResetConfirmed(2, { ok: true, data: [] }), false)
  assert.equal(isOpenAiResetConfirmed(2, { ok: false, error: 'Unavailable' }), false)
})
