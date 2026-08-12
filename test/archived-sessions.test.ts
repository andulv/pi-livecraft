import assert from 'node:assert/strict'
import test from 'node:test'
import {
  archivedSessionsStorageKey,
  readArchivedSessionPaths,
  toggleArchivedSessionPath,
  writeArchivedSessionPaths,
} from '../src/features/workspace/archived-sessions.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

test('persists project-scoped archived session paths', () => {
  const storage = memoryStorage()
  writeArchivedSessionPaths(storage, 'project-1', ['/sessions/one.jsonl'])
  assert.deepEqual(readArchivedSessionPaths(storage, 'project-1'), ['/sessions/one.jsonl'])
  assert.deepEqual(readArchivedSessionPaths(storage, 'project-2'), [])

  writeArchivedSessionPaths(storage, 'project-1', [])
  assert.equal(storage.getItem(archivedSessionsStorageKey('project-1')), null)
})

test('rejects invalid and duplicate archived session paths', () => {
  const storage = memoryStorage({
    [archivedSessionsStorageKey('project-1')]: JSON.stringify([
      '/sessions/one.jsonl',
      '/sessions/one.jsonl',
      '',
      42,
    ]),
  })
  assert.deepEqual(readArchivedSessionPaths(storage, 'project-1'), ['/sessions/one.jsonl'])
})

test('toggles an archived session path', () => {
  assert.deepEqual(
    toggleArchivedSessionPath(['/sessions/one.jsonl'], '/sessions/two.jsonl'),
    ['/sessions/two.jsonl', '/sessions/one.jsonl'],
  )
  assert.deepEqual(toggleArchivedSessionPath(['/sessions/one.jsonl'], '/sessions/one.jsonl'), [])
})
