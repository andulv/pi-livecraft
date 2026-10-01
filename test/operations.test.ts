import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OperationLedger,
  operationBurstThresholds,
  operationRouteTemplate,
  parseOperationAnomaly,
  parseOperationOrigin,
  requestFanoutThreshold,
  safeOperationDetail,
  type OperationAnomaly,
  type OperationBurstReport,
  type RequestFanoutReport,
  type SlowOperationReport,
} from '../server/features/diagnostics/operations.ts'
import type { OperationKind } from '../shared/types.ts'

class RecordingSink {
  slow: SlowOperationReport[] = []
  bursts: OperationBurstReport[] = []
  fanouts: RequestFanoutReport[] = []
  readonly receive = (anomaly: OperationAnomaly): void => {
    if (anomaly.type === 'slow-operation') this.slow.push(anomaly.report)
    else if (anomaly.type === 'operation-burst') this.bursts.push(anomaly.report)
    else this.fanouts.push(anomaly.report)
  }
}

function ledgerWithClock(burstThreshold = 1000) {
  let now = 0
  const ledger = new OperationLedger({
    now: () => now,
    burstThresholds: Object.fromEntries(
      Object.keys(operationBurstThresholds).map((kind) => [kind, burstThreshold]),
    ) as Record<OperationKind, number>,
  })
  const sink = new RecordingSink()
  ledger.setSink(sink.receive)
  return {
    ledger,
    sink,
    advance: (ms: number) => {
      now += ms
    },
  }
}

test('attributes nested operations to the request route and cause', async () => {
  const { ledger } = ledgerWithClock()
  const context = ledger.openRequest('git', 'git:tool-end')
  await ledger.runInRequest(context, async () => {
    await Promise.all([
      ledger.measure('git', 'status', async () => undefined),
      ledger.measure('git', 'diff', async () => undefined),
    ])
    await ledger.measure('git', 'status', async () => undefined)
  })
  ledger.closeRequest(context)
  await ledger.measure('manager-rpc', 'list', async () => undefined)

  const state = ledger.snapshotState()
  assert.equal(state.totals['git:status']?.count, 2)
  assert.equal(state.totals['git:diff']?.count, 1)
  assert.deepEqual(state.triggers['git ← git:tool-end'], { requests: 1, operations: 3 })
  assert.deepEqual(state.triggers['background ← background'], { requests: 1, operations: 1 })
  assert.equal(state.recent.at(-1)?.cause, 'background')
  assert.equal(state.inFlight, 0)
})

test('labels missing and malformed causes instead of trusting the header', () => {
  const { ledger } = ledgerWithClock()
  assert.equal(ledger.openRequest('git', undefined).cause, 'unspecified')
  assert.equal(ledger.openRequest('git', 'git:/home/user path').cause, 'invalid')
  assert.equal(ledger.openRequest('git', ['git:manual', 'x']).cause, 'git:manual')
  assert.equal(ledger.openRequest('git\n/../x y', 'git:manual').route, 'invalid')
  assert.equal(safeOperationDetail('get_state'), 'get_state')
  assert.equal(safeOperationDetail('rm -rf /'), 'other')
  assert.equal(safeOperationDetail(42), 'other')
})

test('exposes the current request as an origin to forward to the manager', async () => {
  const { ledger } = ledgerWithClock()
  assert.equal(ledger.currentOrigin(), undefined)
  const context = ledger.openRequest('sessions', 'sessions:manual')
  await ledger.runInRequest(context, async () => {
    await Promise.resolve()
    assert.deepEqual(ledger.currentOrigin(), { route: 'sessions', cause: 'sessions:manual' })
  })
  assert.deepEqual(parseOperationOrigin({ route: 'git', cause: 'git:manual' }), {
    route: 'git',
    cause: 'git:manual',
  })
  assert.equal(parseOperationOrigin({ route: 'git' }), undefined)
  assert.equal(parseOperationOrigin('git'), undefined)
})

test('accepts forwarded anomalies only from known fields', () => {
  const slow = parseOperationAnomaly({
    type: 'slow-operation',
    report: {
      operation: 'pi-rpc',
      detail: 'get_state',
      route: 'sessions',
      cause: 'sessions:manual',
      durationMs: 1200,
      ok: true,
      inFlight: 3,
      prompt: 'must not survive',
    },
  })
  assert.deepEqual(slow?.report, {
    operation: 'pi-rpc',
    detail: 'get_state',
    route: 'sessions',
    cause: 'sessions:manual',
    durationMs: 1200,
    ok: true,
    inFlight: 3,
  })
  const fanout = parseOperationAnomaly({
    type: 'request-fanout',
    report: {
      route: 'sessions',
      cause: 'background',
      operations: 25,
      byKind: { 'pi-rpc': 25, 'unknown': 4 },
      durationMs: 80,
    },
  })
  assert.equal(fanout?.type, 'request-fanout')
  assert.deepEqual(fanout.report.byKind, { 'pi-rpc': 25 })
  assert.equal(
    parseOperationAnomaly({ type: 'slow-operation', report: { operation: 'x' } }),
    undefined,
  )
  assert.equal(parseOperationAnomaly({ type: 'other', report: {} }), undefined)
})

test('counts failures and reports slow operations without losing the error', async () => {
  const { ledger, sink, advance } = ledgerWithClock()
  await assert.rejects(
    ledger.measure('git', 'push', async () => {
      advance(1500)
      throw new Error('rejected')
    }),
    /rejected/,
  )
  assert.equal(ledger.snapshotState().totals['git:push']?.failures, 1)
  assert.equal(sink.slow.length, 1)
  assert.equal(sink.slow[0]?.durationMs, 1500)
  assert.equal(sink.slow[0]?.ok, false)
})

test('reports a request fan-out once at close', async () => {
  const { ledger, sink } = ledgerWithClock()
  const context = ledger.openRequest('git/diff', 'git:file-select')
  await ledger.runInRequest(context, async () => {
    for (let index = 0; index < requestFanoutThreshold; index++) {
      await ledger.measure('git', 'rev-parse', async () => undefined)
    }
  })
  ledger.closeRequest(context)
  assert.equal(sink.fanouts.length, 1)
  assert.deepEqual(sink.fanouts[0]?.byKind, { git: requestFanoutThreshold })
  assert.equal(sink.fanouts[0]?.cause, 'git:file-select')
})

test('reports one burst per window with its top triggers', async () => {
  const { ledger, sink, advance } = ledgerWithClock(3)
  for (let index = 0; index < 5; index++) {
    await ledger.measure('git', 'status', async () => undefined)
  }
  assert.equal(sink.bursts.length, 1)
  assert.deepEqual(sink.bursts[0]?.topTriggers, [
    { trigger: 'background ← background', operations: 3 },
  ])
  advance(10_000)
  for (let index = 0; index < 3; index++) {
    await ledger.measure('git', 'status', async () => undefined)
  }
  assert.equal(sink.bursts.length, 2)
})

test('masks identifiers in route templates but keeps fixed routes', () => {
  assert.equal(operationRouteTemplate('/api/sessions/abc-123/snapshot'), 'sessions/:id/snapshot')
  assert.equal(operationRouteTemplate('/api/sessions/recent'), 'sessions/recent')
  assert.equal(
    operationRouteTemplate('/api/terminal/instances/t1/stream'),
    'terminal/instances/:id/stream',
  )
  assert.equal(operationRouteTemplate('/api/git'), 'git')
})
