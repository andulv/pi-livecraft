import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecentSession, SessionSummary } from '../shared/types.ts'
import {
  discardableNewSessions,
  restoreWorkspaceSession,
} from '../src/features/workspace/session-selection.ts'

const recent = (path: string): RecentSession => ({
  id: path,
  cwd: '/main',
  name: path,
  sessionPath: path,
  updatedAt: 1,
})
const active = (path: string, cwd = '/main'): SessionSummary => ({
  id: `live:${path}`,
  cwd,
  name: path,
  sessionPath: path,
  status: 'idle',
  pendingUi: [],
})

test('missing remembered session falls back without retrying it as the newest row', async () => {
  const opened: string[] = []
  const stale: string[] = []
  const id = await restoreWorkspaceSession({
    cwd: '/main',
    preferredPaths: ['/missing'],
    visibleSessions: [recent('/missing'), recent('/newest')],
    activeSessions: [],
    openTarget: async ({ sessionPath }) => {
      opened.push(sessionPath)
      if (sessionPath === '/missing') throw new Error('Session not found')
      return sessionPath
    },
    onStalePath: (path) => stale.push(path),
  })
  assert.equal(id, '/newest')
  assert.deepEqual(opened, ['/missing', '/newest'])
  assert.deepEqual(stale, ['/missing'])
})

test('a remembered live session moved to another checkout is not selected or reopened', async () => {
  const stale: string[] = []
  const id = await restoreWorkspaceSession({
    cwd: '/main',
    preferredPaths: ['/moved'],
    visibleSessions: [recent('/moved'), recent('/newest')],
    activeSessions: [active('/moved', '/worktree'), active('/newest')],
    openTarget: async ({ activeSessionId }) => activeSessionId,
    onStalePath: (path) => stale.push(path),
  })
  assert.equal(id, 'live:/newest')
  assert.deepEqual(stale, ['/moved'])
})

test('URL selection takes precedence and a valid old remembered session can still reopen', async () => {
  const options = {
    cwd: '/main',
    visibleSessions: [recent('/newest')],
    activeSessions: [],
    openTarget: async ({ sessionPath }: { sessionPath: string }) => sessionPath,
    onStalePath: () => assert.fail('valid selection was discarded'),
  }
  assert.equal(
    await restoreWorkspaceSession({ ...options, preferredPaths: ['/url', '/older'] }),
    '/url',
  )
  assert.equal(
    await restoreWorkspaceSession({ ...options, preferredPaths: [undefined, '/older'] }),
    '/older',
  )
})

test('all stale selections in an empty workspace leave the new-session action available', async () => {
  let attempts = 0
  const id = await restoreWorkspaceSession({
    cwd: '/main',
    preferredPaths: ['/missing', '/missing'],
    visibleSessions: [recent('/missing')],
    activeSessions: [],
    openTarget: async () => {
      attempts++
      throw new Error('Session not found')
    },
    onStalePath: () => {},
  })
  assert.equal(id, undefined)
  assert.equal(attempts, 1)
})

test('real fallback failures are not hidden', async () => {
  await assert.rejects(
    restoreWorkspaceSession({
      cwd: '/main',
      preferredPaths: [],
      visibleSessions: [recent('/newest')],
      activeSessions: [],
      openTarget: async () => {
        throw new Error('Manager disconnected')
      },
      onStalePath: () => {},
    }),
    /Manager disconnected/,
  )
})

test('navigation preserves multiple draft-bearing new sessions and discards only empty ones', () => {
  const transient = new Set(['main-draft', 'worktree-draft', 'empty', 'whitespace'])
  const drafts = new Map([['main-draft', 'Unsent main prompt'], [
    'worktree-draft',
    'Unsent worktree prompt',
  ], ['whitespace', '  \n']])
  assert.deepEqual(discardableNewSessions(transient, drafts), ['empty', 'whitespace'])
  assert.deepEqual(discardableNewSessions(transient, drafts, 'empty'), ['whitespace'])
  drafts.set('main-draft', '')
  assert.deepEqual(discardableNewSessions(transient, drafts), ['main-draft', 'empty', 'whitespace'])
  transient.delete('main-draft') // First successful send retains the session permanently.
  assert.deepEqual(discardableNewSessions(transient, drafts), ['empty', 'whitespace'])
})
