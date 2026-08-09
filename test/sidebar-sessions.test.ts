import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecentSession, SessionSummary } from '../shared/types.ts'
import {
  compareWorkspaces,
  newestWorkspaceSession,
  reusableNewSession,
  sidebarSessions,
  workspaceActivity,
} from '../src/features/workspace/sidebar-sessions.ts'

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

test('keeps a sent session visible when persistence temporarily omits it', () => {
  assert.deepEqual(sidebarSessions([], '/workspace', [persisted]), [persisted])
})

test('uses persisted order once the sent session is returned', () => {
  const other = {
    ...persisted,
    id: 'other-id',
    sessionPath: '/sessions/other.jsonl',
    updatedAt: 999,
  }
  const refreshed = { ...persisted, name: 'Generated title', updatedAt: 789 }

  assert.deepEqual(sidebarSessions([other, refreshed], '/workspace', [persisted]), [
    other,
    refreshed,
  ])
})

test('reports latest workspace activity from persisted and optimistic sessions', () => {
  assert.equal(
    workspaceActivity('/workspace', [{ ...persisted, updatedAt: 100 }], [
      { ...persisted, id: 'pending', sessionPath: '/sessions/pending.jsonl', updatedAt: 200 },
    ]),
    200,
  )
  assert.equal(workspaceActivity('/other', [persisted]), 0)
})

test('keeps the main workspace above more recently active linked worktrees', () => {
  const main = { path: '/workspace', branch: 'main', main: true }
  const linked = { path: '/workspace-feature', branch: 'feature', main: false }
  const recent = [{ ...persisted, cwd: linked.path, updatedAt: 200 }]

  assert.equal(compareWorkspaces(main, linked, recent), -1)
  assert.equal(compareWorkspaces(linked, main, recent), 1)
})

test('orders linked worktrees by their latest activity', () => {
  const older = { path: '/workspace-old', branch: 'old', main: false }
  const newer = { path: '/workspace-new', branch: 'new', main: false }
  const recent = [{ ...persisted, cwd: newer.path, updatedAt: 200 }]

  assert.equal(compareWorkspaces(newer, older, recent), -200)
  assert.equal(compareWorkspaces(older, newer, recent), 200)
})

test('orders sessions by their latest activity', () => {
  const older = { ...persisted, updatedAt: 100 }
  const newer = {
    ...persisted,
    id: 'newer-id',
    sessionPath: '/sessions/newer.jsonl',
    updatedAt: 200,
  }

  assert.deepEqual(sidebarSessions([older, newer], '/workspace'), [newer, older])
})

test('reuses a live new session only while it has no persisted messages', () => {
  const empty: SessionSummary = {
    id: 'empty',
    cwd: '/workspace',
    name: 'New session',
    sessionPath: '/sessions/empty.jsonl',
    status: 'idle',
    pendingUi: [],
  }
  assert.equal(reusableNewSession([empty], [], '/workspace'), empty)
  assert.equal(
    reusableNewSession(
      [empty],
      [{ ...persisted, sessionPath: '/sessions/empty.jsonl' }],
      '/workspace',
    ),
    null,
  )
})

// -- newestWorkspaceSession ------------------------------------------------

const newestVisible: RecentSession = {
  id: 'newest',
  cwd: '/workspace',
  name: 'Newest',
  sessionPath: '/sessions/newest.jsonl',
  updatedAt: 300,
}

const olderVisible: RecentSession = {
  ...newestVisible,
  id: 'older',
  name: 'Older',
  sessionPath: '/sessions/older.jsonl',
  updatedAt: 200,
}

test('selects the session at the top of the workspace list', () => {
  assert.deepEqual(newestWorkspaceSession([newestVisible, olderVisible], []), {
    sessionPath: newestVisible.sessionPath,
    activeSessionId: undefined,
  })
})

test('reuses the live process for the newest session', () => {
  const active: SessionSummary = {
    id: 'active-newest',
    cwd: '/workspace',
    name: 'Newest',
    sessionPath: newestVisible.sessionPath,
    status: 'idle',
    pendingUi: [],
  }
  assert.deepEqual(newestWorkspaceSession([newestVisible, olderVisible], [active]), {
    sessionPath: newestVisible.sessionPath,
    activeSessionId: active.id,
  })
})

test('returns no target for an empty workspace', () => {
  assert.equal(newestWorkspaceSession([], []), null)
})
