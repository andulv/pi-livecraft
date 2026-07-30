import assert from 'node:assert/strict'
import test from 'node:test'
import { improvementDirectionInstruction } from '../server/prompt-improvement.ts'

const supported = ['clarify', 'ideate', 'precise']

for (const key of supported) {
  test(`returns an instruction for "${key}"`, () => {
    const instruction = improvementDirectionInstruction(key)
    assert.ok(typeof instruction === 'string' && instruction.length > 0)
  })
}

const removed = ['actionable', 'debug', 'plan', 'concise', 'review']

for (const key of removed) {
  test(`returns undefined for removed preset "${key}"`, () => {
    assert.equal(improvementDirectionInstruction(key), undefined)
  })
}

test('returns undefined for an unknown key', () => {
  assert.equal(improvementDirectionInstruction('unknown'), undefined)
})
