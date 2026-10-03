import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFileTree,
  refreshDirectories,
  survivingTreePath,
} from '../src/features/files/file-tree-data.ts'
import type { DirectoryState } from '../src/features/files/file-tree-data.ts'

test('refreshes loaded collapsed folders, prunes deleted trees, and falls back to a surviving parent', async () => {
  const folder = (path: string) => ({ kind: 'directory' as const, name: path, path })
  const state = (...entries: ReturnType<typeof folder>[]): DirectoryState => ({
    entries,
    loading: false,
    error: null,
  })
  const previous = {
    '': state(folder('src'), folder('gone')),
    src: state(folder('src/nested')),
    'src/nested': state(),
    gone: state(folder('gone/child')),
    'gone/child': state(),
  }
  const reads: string[] = []
  const result = await refreshDirectories(previous, async (path) => {
    reads.push(path)
    if (path === '') return [folder('src'), folder('new')]
    return []
  })
  assert.deepEqual(reads, ['', 'src'])
  assert.deepEqual(Object.keys(result.directories), ['', 'src'])
  assert.equal(result.error, null)
  assert.equal(survivingTreePath('src/nested/file.txt', result.directories), 'src')
  assert.equal(survivingTreePath('gone/child', result.directories), null)
  assert.equal(survivingTreePath('new', result.directories), 'new')
})

test('failed refresh retains old listings and subtrees instead of implying deletion', async () => {
  const previous: Record<string, DirectoryState> = {
    '': { entries: [{ kind: 'directory', name: 'src', path: 'src' }], loading: false, error: null },
    src: {
      entries: [{ kind: 'directory', name: 'nested', path: 'src/nested' }],
      loading: false,
      error: null,
    },
    'src/nested': { entries: [], loading: false, error: null },
  }
  const result = await refreshDirectories(previous, async (path) => {
    if (path === '') return previous['']!.entries
    throw new Error('Unavailable')
  })
  assert.deepEqual(result.directories, previous)
  assert.match(result.error!, /src: Unavailable/)
  assert.equal(survivingTreePath('src/nested', result.directories), 'src/nested')
  const rootFailure = await refreshDirectories(previous, async () => {
    throw new Error('Offline')
  })
  assert.deepEqual(rootFailure.directories, previous)
  assert.match(rootFailure.error!, /Workspace: Offline/)
})

test('keeps unloaded directories expandable and filters files at each loaded level', () => {
  const entries = [
    { kind: 'directory' as const, name: 'src', path: 'src' },
    { kind: 'directory' as const, name: 'docs', path: 'docs' },
    { kind: 'file' as const, name: 'readme.md', path: 'readme.md' },
  ]
  const directories = {
    src: {
      entries: [
        { kind: 'file' as const, name: 'App.tsx', path: 'src/App.tsx' },
        { kind: 'file' as const, name: 'api.ts', path: 'src/api.ts' },
      ],
      loading: false,
      error: null,
    },
  }

  assert.deepEqual(buildFileTree(entries, directories, 'app'), [
    {
      id: 'src',
      kind: 'directory',
      name: 'src',
      path: 'src',
      children: [{ id: 'src/App.tsx', kind: 'file', name: 'App.tsx', path: 'src/App.tsx' }],
    },
    { id: 'docs', kind: 'directory', name: 'docs', path: 'docs', children: [] },
  ])
})

test('shows an inline loading row and a retryable error without turning folders into leaves', () => {
  const entries = [{ kind: 'directory' as const, name: 'src', path: 'src' }]
  const loading = buildFileTree(entries, {
    src: { entries: [], loading: true, error: null },
  }, '')
  const failed = buildFileTree(entries, {
    src: { entries: [], loading: false, error: 'Unavailable' },
  }, '')

  assert.equal(loading[0]?.kind, 'directory')
  assert.equal(failed[0]?.kind, 'directory')
  if (loading[0]?.kind !== 'directory' || failed[0]?.kind !== 'directory') return

  assert.deepEqual(loading[0].children, [
    { id: 'src\0loading', kind: 'loading', name: 'Loading…', path: 'src' },
  ])
  assert.deepEqual(failed[0].children, [
    {
      id: 'src\0error',
      kind: 'error',
      name: 'Couldn’t load files: Unavailable (click to retry)',
      path: 'src',
    },
  ])
})
