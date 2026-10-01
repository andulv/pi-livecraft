import { monitorEventLoopDelay } from 'node:perf_hooks'
import type {
  StabilitySnapshot,
  StabilityStreamKind,
  StabilityWindow,
} from '../../../shared/types.ts'

/** Length of one sampling window. */
export const stabilityWindowMs = 10_000
/** Windows kept for `GET /api/diagnostics` (ten minutes). */
const maxRecentWindows = 60
/** A window whose worst event-loop delay reaches this is logged as `event-loop-lag`. */
export const eventLoopLagThresholdMs = 200
/**
 * Chrome allows six concurrent HTTP/1.1 connections per origin, shared by every tab of one
 * browser profile; requests beyond them queue until a connection frees. Long-lived streams
 * hold their connection, so reaching six open streams can starve ordinary requests
 * (snapshots, Git) indefinitely. The gauge counts every client, so it is an upper bound for
 * any single browser.
 */
export const streamPressureThreshold = 6
/** Browser capture is summarized at most once per this many windows (one minute). */
const browserActivityWindows = 6

/** One browser instance's capture counters; `session` is an opaque identity, never logged. */
export interface BrowserCaptureSample {
  session: object
  state: string
  viewerCount: number
  capturedFrames: number
  capturedBytes: number
}

export type StabilityLogKind =
  | 'event-loop-lag'
  | 'stream-pressure'
  | 'sse-close'
  | 'browser-activity'
  | 'browser-state'

export type StabilitySink = (kind: StabilityLogKind, fields: Record<string, unknown>) => void

/** The subset of a Node event-loop delay histogram the monitor reads (nanoseconds). */
export interface LoopDelayHistogram {
  readonly max: number
  percentile(percentile: number): number
  reset(): void
  enable(): void
  disable(): void
}

/** The subset of a `ServerResponse` needed to track a long-lived stream. */
export interface TrackedResponse {
  once(event: 'close', listener: () => void): unknown
  /** Only HTTP responses have it; socket kinds never log `sse-close`. */
  readonly writableFinished?: boolean
}

export interface StabilityMonitorOptions {
  sink: StabilitySink
  sampleBrowsers?: () => BrowserCaptureSample[]
  loopDelay?: LoopDelayHistogram
  now?: () => number
}

interface BrowserTotals {
  frames: number
  bytes: number
  state: string
}

/**
 * Bounded, content-free stability signals for diagnosing connection loss and stalls:
 * backend event-loop delay, open long-lived streams by kind, `/api/events` closures, and
 * shared-browser capture activity. Every window is kept in memory for diagnostics; the
 * app log receives only anomalies, closures, state changes, and one capture summary per
 * active minute, so entries line up with client `sse-drop` and `fetch-stall` reports.
 */
export class StabilityMonitor {
  readonly #sink: StabilitySink
  readonly #sampleBrowsers: () => BrowserCaptureSample[]
  readonly #loopDelay: LoopDelayHistogram
  readonly #now: () => number
  readonly #open: Record<StabilityStreamKind, number> = {
    'events': 0,
    'browser-frames': 0,
    'browser-socket': 0,
    'terminal': 0,
  }
  readonly #browserTotals = new WeakMap<object, BrowserTotals>()
  #recent: StabilityWindow[] = []
  #peakStreams = 0
  #pressureReported = false
  #windowsSinceBrowserLog = 0
  #pendingActivity = { frames: 0, bytes: 0, viewers: 0, live: 0 }
  #timer: ReturnType<typeof setInterval> | undefined

  constructor(options: StabilityMonitorOptions) {
    this.#sink = options.sink
    this.#sampleBrowsers = options.sampleBrowsers ?? (() => [])
    this.#loopDelay = options.loopDelay ?? monitorEventLoopDelay({ resolution: 10 })
    this.#now = options.now ?? Date.now
  }

  /** Starts sampling; the timer never keeps the process alive. */
  start(): void {
    if (this.#timer) return
    this.#loopDelay.enable()
    this.#timer = setInterval(() => this.sample(), stabilityWindowMs)
    this.#timer.unref()
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
    this.#loopDelay.disable()
  }

  /**
   * Counts one long-lived response until it closes. `/api/events` closures are logged with
   * their lifetime and whether the server finished the stream or the transport closed it.
   */
  trackStream(kind: StabilityStreamKind, response: TrackedResponse): void {
    const openedAt = this.#now()
    this.#open[kind] += 1
    const total = this.#totalOpen()
    this.#peakStreams = Math.max(this.#peakStreams, total)
    if (total >= streamPressureThreshold && !this.#pressureReported) {
      this.#pressureReported = true
      this.#sink('stream-pressure', { open: total, byKind: { ...this.#open } })
    }
    response.once('close', () => {
      this.#open[kind] = Math.max(0, this.#open[kind] - 1)
      // Re-arms below the threshold so one sustained episode logs once.
      if (this.#totalOpen() < streamPressureThreshold - 1) this.#pressureReported = false
      if (kind !== 'events') return
      this.#sink('sse-close', {
        lifetimeMs: Math.max(0, this.#now() - openedAt),
        reason: response.writableFinished ? 'server-finished' : 'transport-closed',
        open: { ...this.#open },
      })
    })
  }

  /** Closes one sampling window; the interval timer calls it, tests call it directly. */
  sample(): void {
    const loopP50Ms = round(this.#loopDelay.percentile(50) / 1e6)
    const loopP99Ms = round(this.#loopDelay.percentile(99) / 1e6)
    const loopMaxMs = round(this.#loopDelay.max / 1e6)
    this.#loopDelay.reset()
    const browser = this.#sampleBrowserWindow()
    const window: StabilityWindow = {
      t: this.#now(),
      loopP50Ms,
      loopP99Ms,
      loopMaxMs,
      streams: { ...this.#open },
      browser,
    }
    this.#recent.push(window)
    if (this.#recent.length > maxRecentWindows) this.#recent.shift()
    if (loopMaxMs >= eventLoopLagThresholdMs) {
      this.#sink('event-loop-lag', {
        p50Ms: loopP50Ms,
        p99Ms: loopP99Ms,
        maxMs: loopMaxMs,
        windowMs: stabilityWindowMs,
        streams: window.streams,
        browserFrames: browser.frames,
      })
    }
    this.#summarizeBrowserActivity(browser)
  }

  /** Serializes the recent windows and current stream counts; bounded and content-free. */
  snapshotState(): StabilitySnapshot {
    return {
      windowMs: stabilityWindowMs,
      streams: { ...this.#open },
      peakStreams: this.#peakStreams,
      recent: [...this.#recent],
    }
  }

  #totalOpen(): number {
    return this.#open['events'] + this.#open['browser-frames'] + this.#open['browser-socket']
      + this.#open['terminal']
  }

  /** Converts per-instance cumulative counters into this window's frames, bytes, and states. */
  #sampleBrowserWindow(): StabilityWindow['browser'] {
    const window = { live: 0, viewers: 0, frames: 0, bytes: 0 }
    for (const sample of this.#sampleBrowsers()) {
      const previous = this.#browserTotals.get(sample.session)
      // A restarted capture resets its counters, so a smaller value starts a new count.
      const frames = previous && sample.capturedFrames >= previous.frames
        ? sample.capturedFrames - previous.frames
        : sample.capturedFrames
      const bytes = previous && sample.capturedBytes >= previous.bytes
        ? sample.capturedBytes - previous.bytes
        : sample.capturedBytes
      if (previous && previous.state !== sample.state)
        this.#sink('browser-state', { from: previous.state, to: sample.state })
      this.#browserTotals.set(sample.session, {
        frames: sample.capturedFrames,
        bytes: sample.capturedBytes,
        state: sample.state,
      })
      if (sample.state === 'live') window.live += 1
      window.viewers += sample.viewerCount
      window.frames += frames
      window.bytes += bytes
    }
    return window
  }

  /** Logs one capture summary per minute that had any viewer or frame. */
  #summarizeBrowserActivity(browser: StabilityWindow['browser']): void {
    const pending = this.#pendingActivity
    pending.frames += browser.frames
    pending.bytes += browser.bytes
    pending.viewers = Math.max(pending.viewers, browser.viewers)
    pending.live = Math.max(pending.live, browser.live)
    this.#windowsSinceBrowserLog += 1
    if (this.#windowsSinceBrowserLog < browserActivityWindows) return
    if (pending.frames > 0 || pending.viewers > 0) {
      const durationMs = this.#windowsSinceBrowserLog * stabilityWindowMs
      this.#sink('browser-activity', {
        live: pending.live,
        maxViewers: pending.viewers,
        frames: pending.frames,
        bytes: pending.bytes,
        fps: round(pending.frames / (durationMs / 1000)),
        durationMs,
      })
    }
    this.#windowsSinceBrowserLog = 0
    this.#pendingActivity = { frames: 0, bytes: 0, viewers: 0, live: 0 }
  }
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0
}
