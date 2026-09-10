import assert from 'node:assert/strict'
import test from 'node:test'
import {
  sessionIdFromFilePath,
  subagentDisplayName,
  subagentOwnerSessionId,
  subagentSessionName,
} from '../shared/subagent-session.ts'

test('persists and recovers a subagent owner without exposing the marker in the label', () => {
  const name = subagentSessionName('owner-id', 'inspect the session list')

  assert.equal(name, 'subagent/owner-id/research: inspect the session list')
  assert.equal(subagentOwnerSessionId(name), 'owner-id')
  assert.equal(subagentDisplayName(name), 'subagent/research: inspect the session list')
})

test('recovers a parent id from a Pi session filename', () => {
  assert.equal(
    sessionIdFromFilePath(
      '/home/user/.pi/agent/sessions/workspace/2026-09-10T12-16-40-158Z_owner-id.jsonl',
    ),
    'owner-id',
  )
  assert.equal(sessionIdFromFilePath(undefined), undefined)
})
