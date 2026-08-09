import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecentSession } from '../shared/types.ts'
import {
  pinnedSessionsStorageKey,
  readPinnedSessions,
  resolvePinnedSessions,
  togglePinnedSession,
  writePinnedSessions,
} from '../src/features/workspace/pinned-sessions.ts'

const session: RecentSession = {
  id: 'session-1',
  cwd: '/repo',
  name: 'Pinned session',
  sessionPath: '/sessions/one.jsonl',
  updatedAt: 100,
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

test('persists project-scoped pinned sessions', () => {
  const storage = memoryStorage()
  writePinnedSessions(storage, 'project-1', [session])
  assert.deepEqual(readPinnedSessions(storage, 'project-1'), [session])
  assert.deepEqual(readPinnedSessions(storage, 'project-2'), [])

  writePinnedSessions(storage, 'project-1', [])
  assert.equal(storage.getItem(pinnedSessionsStorageKey('project-1')), null)
})

test('rejects invalid and duplicate stored pins', () => {
  const storage = memoryStorage({
    [pinnedSessionsStorageKey('project-1')]: JSON.stringify([
      session,
      { ...session, name: 'Duplicate' },
      { name: 'Missing session path' },
    ]),
  })
  assert.deepEqual(readPinnedSessions(storage, 'project-1'), [session])
})

test('toggles pins and refreshes metadata without changing pin order', () => {
  const second = { ...session, id: 'session-2', sessionPath: '/sessions/two.jsonl' }
  const pinned = togglePinnedSession(togglePinnedSession([], session), second)
  assert.deepEqual(pinned.map(({ id }) => id), ['session-2', 'session-1'])
  assert.deepEqual(togglePinnedSession(pinned, session), [second])

  const renamed = { ...session, name: 'Renamed', updatedAt: 200 }
  assert.deepEqual(resolvePinnedSessions(pinned, [renamed]), [second, renamed])
})
