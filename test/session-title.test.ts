import assert from 'node:assert/strict'
import test from 'node:test'
import { fallbackSessionTitle } from '../shared/session-title.ts'

test('normalizes whitespace before deriving the title', () => {
  assert.equal(fallbackSessionTitle('  First\n\tprompt  '), 'First prompt')
})

test('truncates to the first eight words', () => {
  assert.equal(
    fallbackSessionTitle('one two three four five six seven eight nine ten'),
    'one two three four five six seven eight…',
  )
  assert.equal(
    fallbackSessionTitle('one two three four five six seven eight'),
    'one two three four five six seven eight',
  )
})

test('returns an empty title for blank input', () => {
  assert.equal(fallbackSessionTitle('   '), '')
  assert.equal(fallbackSessionTitle(''), '')
})
