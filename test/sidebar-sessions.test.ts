import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecentSession, SessionSummary } from '../shared/types.ts'
import { pickSessionOnOpen, sidebarSessions } from '../src/features/workspace/sidebar-sessions.ts'

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
  const other = { ...persisted, id: 'other-id', sessionPath: '/sessions/other.jsonl', updatedAt: 999 }
  const refreshed = { ...persisted, name: 'Generated title', updatedAt: 789 }

  assert.deepEqual(sidebarSessions([other, refreshed], '/workspace', [persisted]), [other, refreshed])
})

// -- pickSessionOnOpen ------------------------------------------------------

const runningSession: SessionSummary = {
  id: 'active-1',
  cwd: '/workspace',
  name: 'Running session',
  sessionPath: '/sessions/active.jsonl',
  status: 'running',
  pendingUi: [],
}

const idleCompletedSession: SessionSummary = {
  id: 'idle-1',
  cwd: '/workspace',
  name: 'Idle completed',
  sessionPath: '/sessions/idle.jsonl',
  status: 'idle',
  pendingUi: [],
}

const startingSession: SessionSummary = {
  id: 'starting-1',
  cwd: '/workspace',
  name: 'Starting session',
  sessionPath: '/sessions/starting.jsonl',
  status: 'starting',
  pendingUi: [],
}

const exitedSession: SessionSummary = {
  id: 'exited-1',
  cwd: '/workspace',
  name: 'Exited session',
  sessionPath: '/sessions/exited.jsonl',
  status: 'exited',
  pendingUi: [],
}

const visibleCompleted: RecentSession = {
  id: 'idle-1',
  cwd: '/workspace',
  name: 'Idle completed',
  sessionPath: '/sessions/idle.jsonl',
  updatedAt: 200,
}

const visibleRunning: RecentSession = {
  id: 'active-1',
  cwd: '/workspace',
  name: 'Running session',
  sessionPath: '/sessions/active.jsonl',
  updatedAt: 300,
}

const visibleStarting: RecentSession = {
  id: 'starting-1',
  cwd: '/workspace',
  name: 'Starting session',
  sessionPath: '/sessions/starting.jsonl',
  updatedAt: 100,
}

test('pickSessionOnOpen returns the most recent completed unviewed session first', () => {
  const visible = [visibleRunning, visibleCompleted]
  const active = [runningSession, idleCompletedSession]
  const completed = new Set(['/sessions/idle.jsonl'])

  assert.equal(pickSessionOnOpen(visible, active, completed), 'idle-1')
})

test('pickSessionOnOpen falls back to the most recent active session when no completed unviewed', () => {
  const visible = [visibleStarting, visibleRunning]
  const active = [startingSession, runningSession]
  const completed = new Set<string>()

  assert.equal(pickSessionOnOpen(visible, active, completed), 'starting-1')
})

test('pickSessionOnOpen skips idle sessions not flagged as completed', () => {
  const visible = [visibleCompleted]
  const active = [idleCompletedSession]
  const completed = new Set<string>()

  assert.equal(pickSessionOnOpen(visible, active, completed), null)
})

test('pickSessionOnOpen skips exited sessions', () => {
  const visibleExited: RecentSession = { ...visibleCompleted, sessionPath: '/sessions/exited.jsonl' }
  const visible = [visibleExited]
  const active = [exitedSession]
  const completed = new Set(['/sessions/exited.jsonl'])

  assert.equal(pickSessionOnOpen(visible, active, completed), null)
})

test('pickSessionOnOpen returns null when no candidate exists', () => {
  assert.equal(pickSessionOnOpen([], [], new Set()), null)
})

test('pickSessionOnOpen picks a starting session as active', () => {
  const visible = [visibleStarting]
  const active = [startingSession]

  assert.equal(pickSessionOnOpen(visible, active, new Set()), 'starting-1')
})
