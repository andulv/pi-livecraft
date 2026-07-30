import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isNearConversationBottom,
  resumesAutoScrollAfterDownwardScroll,
  suspendsAutoScrollAfterUpwardScroll,
} from '../src/features/conversation/conversation-scroll.ts'

test('isNearConversationBottom identifies viewport proximity to conversation bottom', () => {
  assert.equal(isNearConversationBottom(1_000, 2_000, 1_000), true)
  assert.equal(isNearConversationBottom(951, 2_000, 1_000), true)
  assert.equal(isNearConversationBottom(950, 2_000, 1_000), false)
  assert.equal(isNearConversationBottom(500, 2_000, 1_000), false)
})

test('suspends automatic scrolling after any upward movement', () => {
  assert.equal(suspendsAutoScrollAfterUpwardScroll(1_000, 999), true)
  assert.equal(suspendsAutoScrollAfterUpwardScroll(1_000, 1_000), false)
  assert.equal(suspendsAutoScrollAfterUpwardScroll(1_000, 1_001), false)
})

test('resumes automatic scrolling only after a downward scroll near the bottom', () => {
  assert.equal(resumesAutoScrollAfterDownwardScroll(950, 940, 2_000, 1_000), false)
  assert.equal(resumesAutoScrollAfterDownwardScroll(900, 940, 2_000, 1_000), false)
  assert.equal(resumesAutoScrollAfterDownwardScroll(900, 960, 2_000, 1_000), true)
})
