import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionSummary } from '../shared/types.ts'
import {
  pendingDialogForSession,
  visibleDialogForSession,
} from '../src/features/dialogs/dialog-protocol.ts'

function session(id: string, pendingUi: SessionSummary['pendingUi'] = []): SessionSummary {
  return {
    id,
    cwd: `/workspace/${id}`,
    name: id,
    status: 'running',
    pendingUi,
  }
}

test('keeps a dialog visible only for its owning session', () => {
  const dialog = { sessionId: 'session-a', request: { method: 'confirm', id: 'request-a' } }

  assert.equal(visibleDialogForSession(dialog, 'session-b'), null)
  assert.deepEqual(visibleDialogForSession(dialog, 'session-a'), dialog)
  assert.equal(visibleDialogForSession(null, 'session-a'), null)
})

test('selects a blocking pending request only from the selected session', () => {
  const firstRequest = { method: 'confirm', id: 'request-a' }
  const secondRequest = { method: 'input', id: 'request-b' }
  const sessions = [
    session('session-a', [firstRequest]),
    session('session-b', [secondRequest]),
  ]

  assert.deepEqual(pendingDialogForSession(sessions, 'session-b'), {
    sessionId: 'session-b',
    request: secondRequest,
  })
  assert.deepEqual(pendingDialogForSession(sessions, 'session-a'), {
    sessionId: 'session-a',
    request: firstRequest,
  })
  assert.equal(pendingDialogForSession(sessions, 'session-c'), null)
})

test('does not expose the silent agent selector as a user dialog', () => {
  const agentSelector = {
    method: 'select',
    id: 'agent-request',
    title: 'Select an agent',
    options: ['worker'],
  }
  const question = { method: 'confirm', id: 'question-request' }

  assert.deepEqual(
    pendingDialogForSession(
      [session('session-a', [agentSelector, question])],
      'session-a',
    ),
    {
      sessionId: 'session-a',
      request: question,
    },
  )
})
