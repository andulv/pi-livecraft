import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultBrowserCapture,
  parseBrowserCaptureSettings,
} from '../server/features/browser/browser-session.ts'

test('validates capture settings bounds', () => {
  assert.deepEqual(parseBrowserCaptureSettings({ quality: 35, maxFrameRate: 4 }), {
    quality: 35,
    maxFrameRate: 4,
  })
  assert.deepEqual(parseBrowserCaptureSettings(defaultBrowserCapture), defaultBrowserCapture)
  assert.equal(parseBrowserCaptureSettings({ quality: 9, maxFrameRate: 12 }), null)
  assert.equal(parseBrowserCaptureSettings({ quality: 101, maxFrameRate: 12 }), null)
  assert.equal(parseBrowserCaptureSettings({ quality: 60, maxFrameRate: 0 }), null)
  assert.equal(parseBrowserCaptureSettings({ quality: 60, maxFrameRate: 31 }), null)
  assert.equal(parseBrowserCaptureSettings({ quality: 60.5, maxFrameRate: 12 }), null)
  assert.equal(parseBrowserCaptureSettings({ quality: '60', maxFrameRate: 12 }), null)
  assert.equal(parseBrowserCaptureSettings(null), null)
})

test('reports the active capture settings in the session status', async () => {
  const { BrowserSession } = await import('../server/features/browser/browser-session.ts')
  const session = new BrowserSession()
  assert.deepEqual(session.status().capture, { quality: 60, maxFrameRate: 12 })
  await session.setCapture({ quality: 35, maxFrameRate: 4 })
  assert.deepEqual(session.status().capture, { quality: 35, maxFrameRate: 4 })
})
