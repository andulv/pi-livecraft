import assert from 'node:assert/strict'
import test from 'node:test'
import {
  browserBinaryCandidates,
  BrowserLaunchError,
  parseDevToolsEndpoint,
  resolveBrowserBinary,
} from '../server/features/browser/chrome-launcher.ts'

test('parses the DevTools endpoint Chrome prints on startup', () => {
  const output = [
    'Some chrome log line',
    'DevTools listening on ws://127.0.0.1:43555/devtools/browser/abc-123',
    'More log lines',
  ]
    .join('\n')
  assert.equal(
    parseDevToolsEndpoint(output),
    'ws://127.0.0.1:43555/devtools/browser/abc-123',
  )
})

test('ignores stderr without a DevTools endpoint', () => {
  assert.equal(parseDevToolsEndpoint('failed to launch: no display'), null)
  assert.equal(parseDevToolsEndpoint(''), null)
})

test('resolves the browser binary override before platform candidates', async () => {
  const existing = new Set(['/opt/custom/chrome', '/usr/bin/chromium'])
  const resolve = (env: NodeJS.ProcessEnv) =>
    resolveBrowserBinary(env, 'linux', async (path) => existing.has(path))

  assert.equal(
    await resolve({ PI_LIVECRAFT_BROWSER_BIN: '/opt/custom/chrome' }),
    '/opt/custom/chrome',
  )
  assert.equal(await resolve({}), '/usr/bin/chromium')

  await assert.rejects(
    resolve({ PI_LIVECRAFT_BROWSER_BIN: '/missing/chrome' }),
    BrowserLaunchError,
  )
})

test('rejects with an actionable message when no browser exists', async () => {
  await assert.rejects(
    resolveBrowserBinary({}, 'linux', async () => false),
    /PI_LIVECRAFT_BROWSER_BIN/,
  )
})

test('offers platform-appropriate candidates', () => {
  const linux = browserBinaryCandidates('linux', {})
  const darwin = browserBinaryCandidates('darwin', {})
  const win32 = browserBinaryCandidates('win32', {
    PROGRAMFILES: 'C:\\Program Files',
    LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
  })
  assert.ok(linux.includes('/usr/bin/google-chrome-stable'))
  assert.ok(darwin[0].includes('Google Chrome.app'))
  assert.ok(win32[0].startsWith('C:\\Program Files\\Google\\Chrome'))
})
