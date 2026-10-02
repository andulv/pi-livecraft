import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecentSession, SessionSummary } from '../shared/types.ts'
import {
  shubAgentMarker,
  newestWorkspaceSession,
  reconcileSessionNames,
  reusableNewSession,
  sidebarSessions,
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

test('includes owned shub-agent children directly below their owner when requested', () => {
  const child: RecentSession = {
    ...persisted,
    id: 'child-id',
    name: 'shub-agent/research: map the session store',
    shubAgent: 'research',
    ownerSessionId: persisted.id,
    sessionPath: '/sessions/child.jsonl',
    updatedAt: 999,
  }

  assert.deepEqual(sidebarSessions([child, persisted], '/workspace'), [persisted])
  assert.deepEqual(sidebarSessions([child, persisted], '/workspace', [], true), [
    persisted,
    child,
  ])
})

test('identifies an opened shub-agent session by its persisted path', () => {
  const opened: SessionSummary = {
    id: 'live-child-id',
    cwd: '/workspace',
    name: 'shub-agent/research: map the session store',
    sessionPath: '/sessions/child.jsonl',
    status: 'idle',
    pendingUi: [],
  }
  const child: RecentSession = {
    ...persisted,
    id: 'persisted-child-id',
    shubAgent: 'research',
    ownerSessionId: persisted.id,
    sessionPath: opened.sessionPath!,
  }

  assert.equal(shubAgentMarker(opened, [persisted, child]), child)
  assert.equal(
    shubAgentMarker({ ...opened, sessionPath: persisted.sessionPath }, [persisted, child]),
    undefined,
  )
})

test('does not include unowned or cross-workspace shub-agent children', () => {
  const orphan: RecentSession = {
    ...persisted,
    id: 'orphan-id',
    name: 'shub-agent/research: orphan',
    shubAgent: 'research',
    ownerSessionId: 'missing-owner',
    sessionPath: '/sessions/orphan.jsonl',
    updatedAt: 999,
  }
  const otherWorkspaceChild: RecentSession = {
    ...orphan,
    id: 'other-child-id',
    ownerSessionId: persisted.id,
    cwd: '/another-workspace',
    sessionPath: '/sessions/other-child.jsonl',
  }

  assert.deepEqual(
    sidebarSessions([persisted, orphan, otherWorkspaceChild], '/workspace', [], true),
    [persisted],
  )
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

test('reconciles session titles without letting a stale scan regress them', () => {
  const live = (id: string, name: string): SessionSummary => ({
    id,
    cwd: '/workspace',
    name,
    sessionPath: `/sessions/${id}.jsonl`,
    status: 'idle',
    pendingUi: [],
  })
  const scanned = (id: string, name: string): RecentSession => ({
    ...persisted,
    id,
    name,
    sessionPath: `/sessions/${id}.jsonl`,
  })
  const result = reconcileSessionNames(
    [live('evented', 'New session'), live('named', 'Live name'), live('unnamed', 'New session')],
    [
      scanned('evented', 'New session'),
      scanned('named', 'Stale scan'),
      scanned('unnamed', 'Derived prompt'),
      scanned('closed', 'Closed session'),
    ],
    // The event arrived while this refresh was in flight, so both views predate it.
    new Map([['/sessions/evented.jsonl', 'Event name']]),
  )
  assert.deepEqual(result.sessions.map(({ name }) => name), [
    'Event name',
    'Live name',
    'Derived prompt',
  ])
  assert.deepEqual(result.recentSessions.map(({ name }) => name), [
    'Event name',
    'Live name',
    'Derived prompt',
    'Closed session',
  ])
})
