import assert from 'node:assert/strict'
import test from 'node:test'
import { activeSessionMessages, visibleSessionMessages } from '../server/session-snapshot.ts'

test('keeps the active conversation before and after compaction', () => {
  const messages = activeSessionMessages([
    { type: 'message', id: 'user-1', parentId: null, message: { role: 'user', content: 'Original request' } },
    { type: 'message', id: 'assistant-1', parentId: 'user-1', message: { role: 'assistant', content: 'Original response' } },
    { type: 'message', id: 'abandoned', parentId: 'user-1', message: { role: 'assistant', content: 'Abandoned branch' } },
    { type: 'compaction', id: 'compact-1', parentId: 'assistant-1', summary: 'Summary' },
    { type: 'message', id: 'user-2', parentId: 'compact-1', message: { role: 'user', content: 'Continue' } },
  ], 'user-2')

  assert.deepEqual(messages, [
    { role: 'user', content: 'Original request' },
    { role: 'assistant', content: 'Original response' },
    { role: 'custom', customType: 'compaction', content: 'Summary', display: true },
    { role: 'user', content: 'Continue' },
  ])
})

test('filters compaction entries without a string summary', () => {
  const messages = activeSessionMessages([
    { type: 'message', id: 'user-1', parentId: null, message: { role: 'user', content: 'Hello' } },
    { type: 'compaction', id: 'compact-1', parentId: 'user-1', summary: 42 },
    { type: 'message', id: 'user-2', parentId: 'compact-1', message: { role: 'user', content: 'World' } },
  ], 'user-2')

  assert.deepEqual(messages, [
    { role: 'user', content: 'Hello' },
    { role: 'user', content: 'World' },
  ])
})

test('keeps visible custom messages out of hidden extension context', () => {
  const visible = { role: 'custom', customType: 'status', content: 'Prêt', display: true }
  const hidden = { role: 'custom', customType: 'secret-context', content: 'Interne', display: false }

  assert.deepEqual(visibleSessionMessages([
    { role: 'user', content: 'Bonjour' },
    visible,
    hidden,
    { role: 'custom', content: 'Type manquant', display: true },
    { role: 'branchSummary', summary: 'Résumé' },
  ]), [
    { role: 'user', content: 'Bonjour' },
    visible,
  ])
})
