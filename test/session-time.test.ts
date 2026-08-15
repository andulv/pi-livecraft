import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSessionTime } from '../src/features/workspace/session-time.ts'

test('formats same-year timestamps with month, day, and time', () => {
  const now = new Date(2026, 0, 20).getTime()
  assert.equal(formatSessionTime(new Date(2026, 7, 14, 9, 5).getTime(), now), 'Aug 14 09:05')
  assert.equal(formatSessionTime(new Date(2026, 11, 31, 23, 59).getTime(), now), 'Dec 31 23:59')
})

test('formats timestamps from another year with the year instead of the time', () => {
  const now = new Date(2026, 0, 20).getTime()
  assert.equal(formatSessionTime(new Date(2025, 7, 14, 9, 5).getTime(), now), 'Aug 14 2025')
})
