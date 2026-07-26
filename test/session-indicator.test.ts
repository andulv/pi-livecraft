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
  assert.equal(sessionIndicator({ ...session, pendingUi: [{ method: 'confirm' }] }, '', noneCompacting, completed), 'waiting')
  assert.equal(sessionIndicator({ ...session, status: 'idle' }, '', noneCompacting, completed), 'complete')
  assert.equal(sessionIndicator({ ...session, status: 'idle' }, session.id, noneCompacting, completed), null)
})

test('prioritizes compacting over working and complete', () => {
  const completed = new Set([session.id])
  const compacting = new Set([session.id])
  const noneCompacting = new Set<string>()

  assert.equal(sessionIndicator(session, '', compacting, completed), 'compacting')
  assert.equal(sessionIndicator({ ...session, status: 'idle' }, '', compacting, completed), 'compacting')
  assert.equal(sessionIndicator({ ...session, status: 'idle' }, session.id, compacting, completed), 'compacting')
  assert.equal(sessionIndicator({ ...session, status: 'idle' }, '', noneCompacting, completed), 'complete')
})
