import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequestGuard, isJsonContentType } from '../server/request-guard.ts'

const guard = createRequestGuard({ backendPort: 43_121, frontendPort: 5173 })

test('allows requests to application hosts and rejects others', () => {
  const base = { method: 'GET', origin: undefined, secFetchSite: undefined }
  assert.equal(guard.violation({ ...base, host: '127.0.0.1:43121' }), null)
  assert.equal(guard.violation({ ...base, host: 'localhost:5173' }), null)
  assert.equal(guard.violation({ ...base, host: 'LOCALHOST:5173' }), null)
  const rebinding = guard.violation({ ...base, host: 'evil.example:43121' })
  assert.equal(rebinding?.status, 403)
  assert.equal(guard.violation({ ...base, host: undefined })?.status, 403)
})

test('state-changing requests need an allowed origin', () => {
  const base = { method: 'POST', host: '127.0.0.1:43121', secFetchSite: undefined }
  assert.equal(guard.violation({ ...base, origin: 'http://localhost:5173' }), null)
  assert.equal(guard.violation({ ...base, origin: 'http://127.0.0.1:43121' }), null)
  assert.equal(guard.violation({ ...base, origin: 'https://evil.example' })?.status, 403)
  assert.equal(guard.violation({ ...base, origin: 'http://localhost:5174' })?.status, 403)
  // A cross-site page cannot strip Sec-Fetch-Site, so "origin absent but browser headers
  // present" is refused; "neither present" is a local non-browser client (curl workflow).
  assert.equal(
    guard.violation({ ...base, origin: undefined, secFetchSite: 'same-origin' })?.status,
    403,
  )
  assert.equal(guard.violation({ ...base, origin: undefined }), null)
  // Rejections name the allowed origins so misconfiguration is self-diagnosing.
  assert.deepEqual(guard.allowedOrigins, [
    'http://127.0.0.1:43121',
    'http://localhost:43121',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ])
})

test('GET and HEAD skip the origin check', () => {
  assert.equal(
    guard.violation({
      method: 'GET',
      host: '127.0.0.1:5173',
      origin: 'https://evil.example',
      secFetchSite: 'cross-site',
    }),
    null,
  )
})

test('JSON content types are recognized with parameters and case', () => {
  assert.equal(isJsonContentType('application/json'), true)
  assert.equal(isJsonContentType('application/json; charset=utf-8'), true)
  assert.equal(isJsonContentType('APPLICATION/JSON'), true)
  assert.equal(isJsonContentType('text/plain'), false)
  assert.equal(isJsonContentType('application/x-www-form-urlencoded'), false)
  assert.equal(isJsonContentType(undefined), false)
})
