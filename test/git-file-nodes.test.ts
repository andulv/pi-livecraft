import assert from 'node:assert/strict'
import test from 'node:test'
import type { GitFileChange } from '../shared/types.ts'
import { gitFileNodes } from '../src/features/git/git-file-nodes.ts'

const files: GitFileChange[] = [
  { path: 'src/App.tsx', status: 'modified', additions: 2, deletions: 1 },
  { path: 'src/api.ts', status: 'added', additions: 3, deletions: 0 },
  { path: 'docs/README.md', status: 'deleted', additions: 0, deletions: 2 },
]

test('flat Git files remain leaves with full paths', () => {
  assert.deepEqual(
    gitFileNodes(files, false),
    files.map((file) => ({
      id: `file:${file.path}`,
      name: file.path,
      file,
    })),
  )
})

test('tree Git files share directories and keep their original file metadata', () => {
  assert.deepEqual(gitFileNodes(files, true), [
    {
      id: 'dir:src',
      name: 'src',
      children: [
        { id: 'file:src/App.tsx', name: 'App.tsx', file: files[0] },
        { id: 'file:src/api.ts', name: 'api.ts', file: files[1] },
      ],
    },
    {
      id: 'dir:docs',
      name: 'docs',
      children: [
        { id: 'file:docs/README.md', name: 'README.md', file: files[2] },
      ],
    },
  ])
})
