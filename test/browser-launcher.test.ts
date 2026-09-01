import assert from 'node:assert/strict'
import test from 'node:test'
import {
  browserBinaryCandidates,
  BrowserLaunchError,
  chromeLaunchArgs,
  parseDevToolsEndpoint,
  resolveBrowserBinary,
} from '../server/features/browser/chrome-launcher.ts'

test('launches with a normal-Chrome fingerprint', () => {
  const args = chromeLaunchArgs('/tmp/profile', 45123)
  assert.ok(args.includes('--disable-blink-features=AutomationControlled'))
  assert.ok(args.includes('--window-size=1280,900'))
  assert.ok(args.includes('--user-data-dir=/tmp/profile'))
  assert.ok(args.includes('--remote-debugging-port=45123'))
  // Hidden scrollbars are a headless tell; visible ones also match what a
  // normal visitor's viewport looks like in the captured frames.
  assert.ok(!args.includes('--hide-scrollbars'))
})

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
