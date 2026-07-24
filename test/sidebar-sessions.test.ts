import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecentSession } from '../shared/types.ts'
import { sidebarSessions } from '../src/features/workspace/sidebar-sessions.ts'

const persisted: RecentSession = {
  id: 'persisted-id',
  cwd: '/workspace',
  name: 'Premier message',
  sessionPath: '/sessions/new.jsonl',
  updatedAt: 456,
}

test('shows persisted sessions from the current workspace', () => {
  assert.deepEqual(sidebarSessions([persisted], '/workspace'), [persisted])
})

test('hides persisted sessions from another workspace', () => {
  assert.deepEqual(sidebarSessions([persisted], '/another-workspace'), [])
})
