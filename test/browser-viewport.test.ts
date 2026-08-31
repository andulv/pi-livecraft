import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBrowserViewport } from '../server/features/browser/browser-session.ts'

test('validates emulated viewport payloads', () => {
  assert.deepEqual(parseBrowserViewport({ width: 390, height: 844, mobile: true }), {
    width: 390,
    height: 844,
    mobile: true,
  })
  assert.deepEqual(parseBrowserViewport({ width: 1280, height: 900 }), {
    width: 1280,
    height: 900,
    mobile: false,
  })

  assert.equal(parseBrowserViewport({ width: 100, height: 800 }), null)
  assert.equal(parseBrowserViewport({ width: 5000, height: 800 }), null)
  assert.equal(parseBrowserViewport({ width: 390.5, height: 844 }), null)
  assert.equal(parseBrowserViewport({ width: '390', height: '844' }), null)
  assert.equal(parseBrowserViewport({ height: 844 }), null)
  assert.equal(parseBrowserViewport('nonsense'), null)
})
