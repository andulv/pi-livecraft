import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionSummary } from '../shared/types.ts'
import { sessionIndicator } from '../src/features/workspace/session-indicator.ts'

const session: SessionSummary = {
  id: 'session-1',
  cwd: '/workspace',
  name: 'Session',
  status: 'running',
  pendingUi: [],
}

test('prioritizes attention and clears completed sessions when they are consulted', () => {
  const completed = new Set([session.id])
  const noneCompacting = new Set<string>()

  assert.equal(sessionIndicator(session, '', noneCompacting, completed), 'working')
  assert.equal(
    sessionIndicator({ ...session, status: 'starting' }, '', noneCompacting, completed),
    'working',
  )
  assert.equal(
    sessionIndicator(
      { ...session, pendingUi: [{ method: 'confirm' }] },
      '',
      noneCompacting,
      completed,
    ),
    'waiting',
  )
  assert.equal(
    sessionIndicator({ ...session, status: 'idle' }, '', noneCompacting, completed),
    'complete',
  )
  assert.equal(
    sessionIndicator({ ...session, status: 'idle' }, session.id, noneCompacting, completed),
    'idle',
  )
})

test('marks a live idle session without a completion event as idle', () => {
  assert.equal(
    sessionIndicator({ ...session, status: 'idle' }, '', new Set(), new Set()),
    'idle',
  )
})

test('survives a page refresh: restored completed ids still show complete for idle, non-selected sessions', () => {
  // After a refresh, sessionStorage restores completed ids; the manager reports the session as idle.
  const restored = new Set([session.id])

  // Still idle, not selected, in restored set → complete indicator survives refresh.
  assert.equal(
    sessionIndicator({ ...session, status: 'idle' }, '', new Set(), restored),
    'complete',
  )

  // Persisting the stable session path also survives a manager restart.
  const restoredPath = new Set(['/sessions/session.jsonl'])
  assert.equal(
    sessionIndicator(
      { ...session, status: 'idle', sessionPath: '/sessions/session.jsonl' },
      '',
      new Set(),
      restoredPath,
    ),
    'complete',
  )
  // If the manager reports it as running (still working), 'working' takes priority.
  assert.equal(
    sessionIndicator({ ...session, status: 'running' }, '', new Set(), restored),
    'working',
  )
  // Selected sessions keep the linked-process idle marker instead of showing complete.
  assert.equal(
    sessionIndicator({ ...session, status: 'idle' }, session.id, new Set(), restored),
    'idle',
  )
})

test('prioritizes compacting over working and complete', () => {
  const completed = new Set([session.id])
  const compacting = new Set([session.id])
  const noneCompacting = new Set<string>()

  assert.equal(sessionIndicator(session, '', compacting, completed), 'compacting')
  assert.equal(
    sessionIndicator({ ...session, status: 'idle' }, '', compacting, completed),
    'compacting',
  )
  assert.equal(
    sessionIndicator({ ...session, status: 'idle' }, session.id, compacting, completed),
    'compacting',
  )
  assert.equal(
    sessionIndicator({ ...session, status: 'idle' }, '', noneCompacting, completed),
    'complete',
  )
})
