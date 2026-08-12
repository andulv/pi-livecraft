import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionIndexEntries } from '../src/features/session-index/session-index.ts'

test('indexes user messages chronologically with their original message positions', () => {
  const entries = sessionIndexEntries([
    { role: 'system', content: 'Session started.' },
    { role: 'user', timestamp: 100, content: 'First request.' },
    { role: 'assistant', content: 'First response.' },
    {
      role: 'user',
      timestamp: 200,
      content: [{ type: 'text', text: 'Second\nrequest.' }, { type: 'image', data: 'abc' }],
    },
    { role: 'toolResult', content: 'ignored' },
  ])

  assert.deepEqual(entries, [
    { messageIndex: 1, number: 1, preview: 'First request.', timestamp: 100 },
    { messageIndex: 3, number: 2, preview: 'Second request.', timestamp: 200 },
  ])
})

test('keeps image-only, empty, and long user messages navigable', () => {
  const entries = sessionIndexEntries([
    { role: 'user', content: [{ type: 'image', data: 'abc' }] },
    { role: 'user', content: '' },
    { role: 'user', content: 'x'.repeat(181) },
  ])

  assert.deepEqual(entries.slice(0, 2), [
    { messageIndex: 0, number: 1, preview: 'Image attachment' },
    { messageIndex: 1, number: 2, preview: 'Untitled message' },
  ])
  assert.equal(entries[2]?.messageIndex, 2)
  assert.equal(entries[2]?.number, 3)
  assert.equal(entries[2]?.preview.length, 180)
  assert.equal(entries[2]?.preview.endsWith('…'), true)
})
