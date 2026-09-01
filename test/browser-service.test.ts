import assert from 'node:assert/strict'
import test from 'node:test'
import {
  browserDebugPortBase,
  browserDebugPortFor,
  browserDebugPortSpan,
  BrowserService,
  parseBrowserId,
} from '../server/features/browser/browser-service.ts'

const primaryBrowserId = 'main'

test('validates browser instance IDs', () => {
  assert.equal(parseBrowserId(primaryBrowserId), 'main')
  assert.equal(parseBrowserId('browser-7a2f'), 'browser-7a2f')
  assert.equal(parseBrowserId('_leading'), null)
  assert.equal(parseBrowserId('has space'), null)
  assert.equal(parseBrowserId(''), null)
  assert.equal(parseBrowserId('a'.repeat(65)), null)
})

test('derives stable, distinct debug ports per workspace instance', () => {
  const aMain = browserDebugPortFor('/workspace/a', 'main')
  const aSecond = browserDebugPortFor('/workspace/a', 'second')
  const bMain = browserDebugPortFor('/workspace/b', 'main')
  assert.equal(browserDebugPortFor('/workspace/a', 'main'), aMain)
  assert.ok(aMain >= browserDebugPortBase && aMain < browserDebugPortBase + browserDebugPortSpan)
  assert.ok(
    aSecond >= browserDebugPortBase && aSecond < browserDebugPortBase + browserDebugPortSpan,
  )
  assert.ok(bMain >= browserDebugPortBase && bMain < browserDebugPortBase + browserDebugPortSpan)
  assert.notEqual(aMain, aSecond)
  assert.notEqual(aMain, bMain)
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
