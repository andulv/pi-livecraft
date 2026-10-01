import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  type BrowserCaptureSample,
  type LoopDelayHistogram,
  StabilityMonitor,
  type StabilityLogKind,
  streamPressureThreshold,
} from '../server/features/diagnostics/stability.ts'

class FakeHistogram implements LoopDelayHistogram {
  max = 0
  p50 = 0
  p99 = 0
  percentile(percentile: number): number {
    return percentile === 50 ? this.p50 : this.p99
  }
  reset(): void {
    this.max = 0
  }
  enable(): void {}
  disable(): void {}
}

class FakeResponse extends EventEmitter {
  writableFinished = false
}

function monitorFixture(samples: () => BrowserCaptureSample[] = () => []) {
  const logged: Array<{ kind: StabilityLogKind; fields: Record<string, unknown> }> = []
  const loopDelay = new FakeHistogram()
  let now = 0
  const monitor = new StabilityMonitor({
    sink: (kind, fields) => logged.push({ kind, fields }),
    sampleBrowsers: samples,
    loopDelay,
    now: () => now,
  })
  return {
    monitor,
    logged,
    loopDelay,
    advance: (ms: number) => {
      now += ms
    },
  }
}

test('logs stream pressure once per episode and re-arms after it eases', () => {
  const { monitor, logged } = monitorFixture()
  const responses = Array.from({ length: streamPressureThreshold + 1 }, () => new FakeResponse())
  responses.forEach((response, index) =>
    monitor.trackStream(index === 0 ? 'browser-frames' : 'events', response)
  )
  assert.equal(logged.filter(({ kind }) => kind === 'stream-pressure').length, 1)
  assert.equal(monitor.snapshotState().peakStreams, streamPressureThreshold + 1)

  for (const response of responses.slice(0, 3)) response.emit('close')
  monitor.trackStream('events', new FakeResponse())
  monitor.trackStream('events', new FakeResponse())
  assert.equal(logged.filter(({ kind }) => kind === 'stream-pressure').length, 2)
})

test('records how long an events stream lived and who closed it', () => {
  const { monitor, logged, advance } = monitorFixture()
  const response = new FakeResponse()
  monitor.trackStream('events', response)
  advance(4_200)
  response.emit('close')
  const closes = logged.filter(({ kind }) => kind === 'sse-close')
  assert.deepEqual(closes[0]?.fields, {
    lifetimeMs: 4_200,
    reason: 'transport-closed',
    open: { 'events': 0, 'browser-frames': 0, 'terminal': 0 },
  })

  const terminal = new FakeResponse()
  monitor.trackStream('terminal', terminal)
  terminal.emit('close')
  assert.equal(logged.filter(({ kind }) => kind === 'sse-close').length, 1)
})

test('logs event-loop lag only for windows at or above the threshold', () => {
  const { monitor, logged, loopDelay } = monitorFixture()
  loopDelay.max = 50e6
  monitor.sample()
  loopDelay.max = 450e6
  loopDelay.p99 = 300e6
  monitor.sample()
  const lags = logged.filter(({ kind }) => kind === 'event-loop-lag')
  assert.equal(lags.length, 1)
  assert.equal(lags[0]?.fields.maxMs, 450)
  assert.equal(lags[0]?.fields.p99Ms, 300)
  assert.equal(monitor.snapshotState().recent.length, 2)
})

test('turns browser counters into per-window capture, state changes, and minute summaries', () => {
  const session = {}
  let sample: BrowserCaptureSample = {
    session,
    state: 'starting',
    viewerCount: 0,
    capturedFrames: 0,
    capturedBytes: 0,
  }
  const { monitor, logged } = monitorFixture(() => [sample])
  monitor.sample()
  sample = { ...sample, state: 'live', viewerCount: 1, capturedFrames: 120, capturedBytes: 2_400 }
  monitor.sample()
  assert.deepEqual(monitor.snapshotState().recent.at(-1)?.browser, {
    live: 1,
    viewers: 1,
    frames: 120,
    bytes: 2_400,
  })
  assert.deepEqual(logged.find(({ kind }) => kind === 'browser-state')?.fields, {
    from: 'starting',
    to: 'live',
  })

  // A restarted capture resets its counters; the smaller value starts a new count.
  sample = { ...sample, capturedFrames: 30, capturedBytes: 600 }
  for (let window = 0; window < 4; window++) monitor.sample()
  const activity = logged.filter(({ kind }) => kind === 'browser-activity')
  assert.equal(activity.length, 1)
  assert.equal(activity[0]?.fields.frames, 150)
  assert.equal(activity[0]?.fields.maxViewers, 1)
})
