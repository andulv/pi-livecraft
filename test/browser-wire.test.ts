import assert from 'node:assert/strict'
import test from 'node:test'
import { wireFor } from '../server/features/browser/browser-session.ts'

test('serializes each session event once for every SSE viewer', () => {
  const frame = wireFor({ type: 'frame', buffer: Buffer.from('abc') })
  assert.deepEqual(frame, { name: 'frame', json: '{"data":"YWJj"}' })
  assert.deepEqual(wireFor({ type: 'url', url: 'https://a.dev' }), {
    name: 'url',
    json: '{"url":"https://a.dev"}',
  })
  assert.deepEqual(wireFor({ type: 'viewport' }), { name: 'viewport', json: '{}' })
  const status = wireFor({ type: 'status', status: { state: 'live' } })
  assert.equal(status.name, 'status')
  assert.deepEqual(JSON.parse(status.json), { state: 'live' })
})
