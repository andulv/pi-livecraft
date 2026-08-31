import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserService, parseBrowserId } from '../server/features/browser/browser-service.ts'

const primaryBrowserId = 'main'

test('validates browser instance IDs', () => {
  assert.equal(parseBrowserId(primaryBrowserId), 'main')
  assert.equal(parseBrowserId('browser-7a2f'), 'browser-7a2f')
  assert.equal(parseBrowserId('_leading'), null)
  assert.equal(parseBrowserId('has space'), null)
  assert.equal(parseBrowserId(''), null)
  assert.equal(parseBrowserId('a'.repeat(65)), null)
})

test('keeps stable browser sessions per workspace and browser ID', async () => {
  const service = new BrowserService()
  const workspaceA = '/workspace/a'
  const workspaceB = '/workspace/b'
  const aMain = service.session(workspaceA, primaryBrowserId)
  const aSecond = service.session(workspaceA, 'second')
  const bMain = service.session(workspaceB, primaryBrowserId)

  assert.strictEqual(service.session(workspaceA, primaryBrowserId), aMain)
  assert.notStrictEqual(aMain, aSecond)
  assert.notStrictEqual(aMain, bMain)

  const snapshot = await service.debugSnapshot()
  assert.deepEqual(
    snapshot.workspaces.map((workspace) => ({
      path: workspace.workspacePath,
      ids: workspace.instances.map((instance) => instance.browserId),
    })),
    [
      { path: workspaceA, ids: ['main', 'second'] },
      { path: workspaceB, ids: ['main'] },
    ],
  )

  await service.remove(workspaceA, 'second')
  const afterRemove = await service.debugSnapshot()
  assert.deepEqual(afterRemove.workspaces[0].instances.map(({ browserId }) => browserId), ['main'])
})
