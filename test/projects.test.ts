import assert from 'node:assert/strict'
import test from 'node:test'
import { projectFromGit, projectId } from '../src/features/workspace/project-definition.ts'

test('creates stable URL-safe project identities and colors', () => {
  const root = '/home/user/source/example'
  const first = projectFromGit({
    root,
    workspaces: [{ path: root, branch: 'main', main: true }],
  })
  const second = projectFromGit({
    root,
    workspaces: [{ path: root, branch: 'main', main: true }],
  })

  assert.equal(first.id, projectId(root))
  assert.match(first.id, /^project-[a-f0-9]{8}$/)
  assert.match(first.color, /^#[a-f0-9]{6}$/i)
  assert.deepEqual(first, second)
  assert.equal(first.name, 'example')
})

test('uses the repository root rather than its display name as identity', () => {
  assert.notEqual(projectId('/source/one/example'), projectId('/source/two/example'))
})

test('allocates a different palette color to registered projects', () => {
  const first = projectFromGit({ root: '/source/one', workspaces: [] })
  const second = projectFromGit({ root: '/source/two', workspaces: [] }, [first])
  assert.notEqual(first.color, second.color)
})
