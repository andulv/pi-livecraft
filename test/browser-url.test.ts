import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeBrowserUrl } from '../src/features/browser/browser-url.ts'

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
