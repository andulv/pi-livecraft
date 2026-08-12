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
    {
      messageIndex: 1,
      number: 1,
      preview: 'First request.',
      timestamp: 100,
      assistant: { messageIndex: 2, preview: 'First response.' },
    },
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

test('keeps the final assistant response of each turn as a muted preview', () => {
  const entries = sessionIndexEntries([
    { role: 'system', content: 'ignored' },
    { role: 'user', timestamp: 100, content: 'First request.' },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'hidden reasoning' },
        { type: 'text', text: '# Earlier summary' },
      ],
    },
    { role: 'toolResult', content: 'ignored tool output' },
    { role: 'assistant', content: [{ type: 'text', text: 'Final notes for turn one.' }] },
    { role: 'user', timestamp: 200, content: 'Second request.' },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'No heading here.\n\nSecond paragraph is ignored.' }],
    },
    { role: 'user', timestamp: 300, content: 'Third, still running.' },
  ])

  assert.deepEqual(entries[0]?.assistant, {
    messageIndex: 4,
    preview: 'Final notes for turn one.',
  })
  assert.deepEqual(entries[1]?.assistant, {
    messageIndex: 6,
    preview: 'No heading here.',
  })
  assert.equal(entries[2]?.assistant, undefined)
})

test('prefers the first Markdown heading of the final response and strips markup', () => {
  const entries = sessionIndexEntries([
    { role: 'user', content: 'Plan it.' },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'Intro line.\n\n## Planned changes ##\nbody' }],
    },
  ])

  assert.equal(entries[0]?.assistant?.preview, 'Planned changes')
})

test('ignores fences and horizontal rules when picking the first response line', () => {
  const entries = sessionIndexEntries([
    { role: 'user', content: 'Show code.' },
    {
      role: 'assistant',
      content: [{
        type: 'text',
        text: '```ts\nconst x = 1\n```\n\n---\n\nHere is the summary.',
      }],
    },
  ])

  assert.equal(entries[0]?.assistant?.preview, 'Here is the summary.')
})
