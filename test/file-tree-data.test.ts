import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFileTree } from '../src/features/files/file-tree-data.ts'

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
