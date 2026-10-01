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
    rpcWaitMs: { state: 300, entries: 1190, thinking: 4 },
    sameSessionInFlight: 2,
    totalInFlight: 4,
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
    rpcWaitMs: { state: 300, entries: 1190, thinking: 4 },
    sameSessionInFlight: 2,
    totalInFlight: 4,
  })
})

test('failed snapshots report the first failing RPC without session content', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'app-log-')), 'app.log')
  new AppLog(path).snapshotFailure('entries', 1200, 3)
  const line = JSON.parse(readFileSync(path, 'utf8').trim())
  assert.deepEqual(line, {
    t: line.t,
    kind: 'snapshot-failure',
    rpc: 'entries',
    durationMs: 1200,
    sameSessionInFlight: 3,
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

test('operation anomalies keep their log kind and name the operation family separately', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'app-log-')), 'app.log')
  const log = new AppLog(path)
  log.operationAnomaly({
    type: 'slow-operation',
    report: {
      operation: 'git',
      detail: 'status',
      route: 'git',
      cause: 'git:tool-end',
      durationMs: 1200,
      ok: true,
      inFlight: 1,
    },
  })
  log.operationAnomaly(
    {
      type: 'operation-burst',
      report: { operation: 'pi-rpc', count: 150, windowMs: 10_000, topTriggers: [] },
    },
    'manager',
  )
  const lines = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line))

  assert.deepEqual(lines.map(({ kind, operation, process }) => [kind, operation, process]), [
    ['slow-operation', 'git', 'backend'],
    ['operation-burst', 'pi-rpc', 'manager'],
  ])
})
