import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionSummary } from '../shared/types.ts'
import {
  aggregateSessionIndicator,
  sessionIndicator,
} from '../src/features/workspace/session-indicator.ts'

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

test('uses the stable session path for current-page completion markers', () => {
  const completed = new Set(['/sessions/session.jsonl'])
  const withPath = { ...session, sessionPath: '/sessions/session.jsonl' }

  assert.equal(
    sessionIndicator({ ...withPath, status: 'idle' }, '', new Set(), completed),
    'complete',
  )
  assert.equal(sessionIndicator(withPath, '', new Set(), completed), 'working')
  assert.equal(
    sessionIndicator({ ...withPath, status: 'idle' }, session.id, new Set(), completed),
    'idle',
  )
})

test('rolls up the highest-priority indicator for a workspace or project', () => {
  assert.equal(
    aggregateSessionIndicator(
      [{ ...session, status: 'idle' }, { ...session, id: 'working', status: 'running' }],
      '',
      new Set(),
      new Set(),
    ),
    'working',
  )
  assert.equal(
    aggregateSessionIndicator(
      [{ ...session, status: 'running' }, {
        ...session,
        id: 'waiting',
        pendingUi: [{ method: 'confirm' }],
      }],
      '',
      new Set(),
      new Set(),
    ),
    'waiting',
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
