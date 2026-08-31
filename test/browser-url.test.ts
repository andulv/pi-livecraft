import assert from 'node:assert/strict'
import test from 'node:test'
import {
  browserUrlStorageKey,
  normalizeBrowserUrl,
  primaryBrowserId,
  readBrowserUrl,
  writeBrowserUrl,
} from '../src/features/browser/browser-url.ts'

test('scopes browser URLs by workspace and instance while migrating the legacy value', () => {
  const values = new Map<string, string>([['pi-livecraft.browser-url', 'https://legacy.test']])
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }

  assert.equal(readBrowserUrl('/workspace/a', primaryBrowserId, storage), 'https://legacy.test')
  assert.equal(values.has('pi-livecraft.browser-url'), false)
  assert.equal(readBrowserUrl('/workspace/b', primaryBrowserId, storage), '')

  writeBrowserUrl('/workspace/a', 'second', 'https://second.test', storage)
  assert.equal(readBrowserUrl('/workspace/a', 'second', storage), 'https://second.test')
  assert.notEqual(
    browserUrlStorageKey('/workspace/a', primaryBrowserId),
    browserUrlStorageKey('/workspace/b', primaryBrowserId),
  )
})

test('normalizes browser address input', () => {
  assert.equal(normalizeBrowserUrl('https://example.com'), 'https://example.com')
  assert.equal(normalizeBrowserUrl('  http://localhost:5173  '), 'http://localhost:5173')
  assert.equal(normalizeBrowserUrl('localhost:3000'), 'http://localhost:3000')
  assert.equal(normalizeBrowserUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080')
  assert.equal(normalizeBrowserUrl('192.168.1.4/app'), 'http://192.168.1.4/app')
  assert.equal(normalizeBrowserUrl('example.com/docs'), 'https://example.com/docs')
  assert.equal(normalizeBrowserUrl('javascript:alert(1)'), null)
  assert.equal(normalizeBrowserUrl('data:text/html,x'), null)
  assert.equal(normalizeBrowserUrl('   '), null)
})
