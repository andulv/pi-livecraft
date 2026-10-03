import assert from 'node:assert/strict'
import test from 'node:test'
import type { GitWorkspace } from '../shared/types.ts'
import { workspaceNavigation } from '../src/features/workspace/workspace-navigation.ts'

const main: GitWorkspace = { path: '/project', branch: 'master', main: true }
const worktrees: GitWorkspace[] = Array.from({ length: 6 }, (_, index) => ({
  path: `/project/worktree-${index}`,
  branch: `feature-${index}`,
  main: false,
}))
const workspaces = [main, ...worktrees]
const paths = (items: GitWorkspace[]): string[] => items.map(({ path }) => path)

test('puts the main checkout first and shows everything when it fits', () => {
  const result = workspaceNavigation([...worktrees, main], main.path, 1600)
  assert.deepEqual(result.visible, workspaces)
  assert.deepEqual(result.overflow, [])
  assert.equal(result.cardWidth, 200)
})

test('reserves main and an overflowing active worktree in stable discovery order', () => {
  const result = workspaceNavigation(workspaces, worktrees[5].path, 700)
  assert.deepEqual(paths(result.visible), [main.path, worktrees[0].path, worktrees[5].path])
  assert.deepEqual(paths(result.overflow), paths(worktrees.slice(1, 5)))
  assert.equal(result.cardWidth, 200)
})

test('keeps main and the active worktree visible even at phone widths', () => {
  const result = workspaceNavigation(workspaces, worktrees[5].path, 300)
  assert.deepEqual(paths(result.visible), [main.path, worktrees[5].path])
  assert.equal(result.cardWidth, 104)
  assert.equal(result.overflow.length, 5)
  assert.equal(result.visible.length * result.cardWidth + 2 * 6 + 80, 300)
})

test('fills available slots without requiring a linked worktree to be selected', () => {
  const result = workspaceNavigation(workspaces, main.path, 700)
  assert.deepEqual(result.visible, workspaces.slice(0, 3))
  assert.deepEqual(result.overflow, workspaces.slice(3))
})

test('accounts for the dropdown only when there is overflow', () => {
  assert.equal(workspaceNavigation(workspaces.slice(0, 2), main.path, 406).overflow.length, 0)
  const result = workspaceNavigation(workspaces.slice(0, 2), main.path, 405)
  assert.deepEqual(result.visible, [main])
  assert.deepEqual(result.overflow, [worktrees[0]])
})

test('handles loading, a lone main checkout, and no main checkout defensively', () => {
  assert.deepEqual(workspaceNavigation([], '', 0), { visible: [], overflow: [], cardWidth: 1 })
  assert.deepEqual(workspaceNavigation([main], main.path, 140), {
    visible: [main],
    overflow: [],
    cardWidth: 140,
  })
  assert.deepEqual(workspaceNavigation(worktrees, worktrees[5].path, 300).visible, [worktrees[5]])
})
