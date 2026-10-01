import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OperationLedger,
  operationRouteTemplate,
  requestFanoutThreshold,
  type OperationAnomalySink,
  type OperationBurstReport,
  type RequestFanoutReport,
  type SlowOperationReport,
} from '../server/features/diagnostics/operations.ts'

class RecordingSink implements OperationAnomalySink {
  slow: SlowOperationReport[] = []
  bursts: OperationBurstReport[] = []
  fanouts: RequestFanoutReport[] = []
  slowOperation(report: SlowOperationReport): void {
    this.slow.push(report)
  }
  operationBurst(report: OperationBurstReport): void {
    this.bursts.push(report)
  }
  requestFanout(report: RequestFanoutReport): void {
    this.fanouts.push(report)
  }
}

function ledgerWithClock(burstThreshold = 1000) {
  let now = 0
  const ledger = new OperationLedger({
    now: () => now,
    burstThresholds: {
      'git': burstThreshold,
      'manager-rpc': burstThreshold,
      'session-store': burstThreshold,
      'prompt-templates': burstThreshold,
    },
  })
  const sink = new RecordingSink()
  ledger.setSink(sink)
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
