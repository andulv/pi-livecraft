import assert from 'node:assert/strict'
import test from 'node:test'
import { resumesAutoScrollAfterDownwardScroll } from '../src/features/conversation/conversation-scroll.ts'

test('resumes automatic scrolling only after a downward scroll near the bottom', () => {
  assert.equal(resumesAutoScrollAfterDownwardScroll(950, 940, 2_000, 1_000), false)
  assert.equal(resumesAutoScrollAfterDownwardScroll(900, 940, 2_000, 1_000), false)
  assert.equal(resumesAutoScrollAfterDownwardScroll(900, 960, 2_000, 1_000), true)
})
