import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  appLogClientEntryCap,
  AppLog,
  parsePreviousRun,
} from '../server/features/app-log/app-log.ts'

test('parsePreviousRun reports a clean exit shutdown', () => {
  const previous = parsePreviousRun(
    '{"t":1,"kind":"boot"}\n{"t":2,"kind":"shutdown","reason":"exit","uptimeMs":42000}\n',
  )
  assert.deepEqual(previous, { uptimeMs: 42000, clean: true })
})

test('parsePreviousRun treats a crash marker and torn lines as unclean', () => {
  assert.deepEqual(
    parsePreviousRun('{"t":1,"kind":"shutdown","reason":"crash","uptimeMs":10}\n'),
    { uptimeMs: 10, clean: false },
  )
  assert.equal(parsePreviousRun('{"t":1,"kind":"snapshot","mode":"full"}\n'), undefined)
  assert.equal(parsePreviousRun('{"torn":'), undefined)
  assert.equal(parsePreviousRun(''), undefined)
})

test('boot reads the previous run, and the log survives a restart', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'app-log-')), 'app.log')
  const first = new AppLog(path)
  first.boot(111)
  first.shutdown('exit')

  const second = new AppLog(path)
  second.boot(222)
  const lines = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line))

  assert.equal(lines.length, 3)
  assert.equal(lines[0].kind, 'boot')
  assert.equal(lines[0].pid, 111)
  assert.equal(lines[0].previousRun, 'unknown')
  assert.deepEqual(lines[1], {
    t: lines[1].t,
    kind: 'shutdown',
    reason: 'exit',
    uptimeMs: lines[1].uptimeMs,
  })
  assert.equal(lines[2].kind, 'boot')
  assert.deepEqual(lines[2].previousRun, { uptimeMs: lines[1].uptimeMs, clean: true })
})

test('shutdown writes once even when both the crash handler and exit fire', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'app-log-')), 'app.log')
  const log = new AppLog(path)
  log.boot(1)
  log.shutdown('crash')
  log.shutdown('exit')
  const lines = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line))

  assert.equal(lines.filter((line) => line.kind === 'shutdown').length, 1)
  assert.equal(lines.at(-1).reason, 'crash')
})

test('slow snapshots retain their content-free stage breakdown', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'app-log-')), 'app.log')
  const log = new AppLog(path)
  log.slowSnapshot({
    mode: 'delta',
    rpcMs: 1200,
    buildMs: 2,
    templatesMs: 0.03,
    totalMs: 1205,
    bytes: 226_000,
  })

  const line = JSON.parse(readFileSync(path, 'utf8').trim())
  assert.deepEqual(line, {
    t: line.t,
    kind: 'slow-snapshot',
    mode: 'delta',
    rpcMs: 1200,
    buildMs: 2,
    templatesMs: 0.03,
    totalMs: 1205,
    bytes: 226_000,
  })
})

test('client entries are capped per run with a single marker', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'app-log-')), 'app.log')
  const log = new AppLog(path)
  log.boot(1)
  for (let index = 0; index < appLogClientEntryCap; index += 1) {
    assert.equal(log.client({ source: 'window-error', message: `boom ${index}` }), true)
  }
  assert.equal(log.client({ source: 'window-error', message: 'beyond cap' }), false)
  assert.equal(log.client({ source: 'sse-drop', message: 'still beyond cap' }), false)

  const lines = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  const clientLines = lines.filter((line) => line.kind === 'client')
  assert.equal(clientLines.length, appLogClientEntryCap)
  const capLines = lines.filter((line) => line.kind === 'client-cap')
  assert.equal(capLines.length, 1)
})

test('uncaught entries carry truncated message and stack', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'app-log-')), 'app.log')
  const log = new AppLog(path)
  const error = new Error('x'.repeat(500))
  log.uncaught('unhandledRejection', error)

  const line = JSON.parse(readFileSync(path, 'utf8').trim()) as { message: string; stack?: string }
  assert.equal(line.message.length, 301) // 300 chars plus the ellipsis
  assert.ok((line.stack?.length ?? 0) > 0)
})
