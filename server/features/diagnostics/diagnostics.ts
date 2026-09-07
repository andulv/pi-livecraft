import type {
  DiagnosticEventEntry,
  DiagnosticsSnapshot,
  SnapshotStageEntry,
} from '../../../shared/types.ts'

const maxRecentEvents = 100
const maxRecentStages = 50

export interface SnapshotStageMeasurement {
  rpcMs: number
  buildMs: number
  templatesMs: number
  totalMs: number
  bytes: number
  mode: 'full' | 'delta'
}

/**
 * Bounded, content-free diagnostics for the local backend: route counters, error and
 * SSE-open counts, snapshot totals, and ring buffers of recent events and snapshot
 * stages. Entries never carry session ids, paths, payloads, or prompts; routes are
 * stored as caller-provided templates. State is memory-only and resets on restart.
 */
export class DiagnosticsRecorder {
  readonly #startedAt = Date.now()
  #sequence = 0
  #events: DiagnosticEventEntry[] = []
  #stages: SnapshotStageEntry[] = []
  #requests = new Map<string, number>()
  #errors = 0
  #sseOpens = 0
  #snapshots = { full: 0, delta: 0, fullBytes: 0, deltaBytes: 0 }

  /** Counts one API request under its route template. */
  request(route: string): void {
    this.#requests.set(route, (this.#requests.get(route) ?? 0) + 1)
    this.#push({ kind: 'request', route, ok: true })
  }

  /** Counts one failed request; the route stays a template without identifiers. */
  error(route: string): void {
    this.#errors += 1
    this.#push({ kind: 'error', route, ok: false })
  }

  /** Counts one SSE stream opening (reconnects included). */
  sseOpen(): void {
    this.#sseOpens += 1
    this.#push({ kind: 'sse-open', ok: true })
  }

  /** Records one finished snapshot with its stage timings and response size. */
  snapshot(stage: SnapshotStageMeasurement): void {
    this.#snapshots[stage.mode] += 1
    if (stage.mode === 'full') this.#snapshots.fullBytes += stage.bytes
    else this.#snapshots.deltaBytes += stage.bytes
    this.#stages.push({ sequence: ++this.#sequence, t: Date.now(), ...stage })
    if (this.#stages.length > maxRecentStages) this.#stages.shift()
    this.#push({
      kind: 'snapshot',
      ok: true,
      durationMs: stage.totalMs,
      bytes: stage.bytes,
      mode: stage.mode,
    })
  }

  /** Serializes the current diagnostics; bounded and content-free. */
  snapshotState(): DiagnosticsSnapshot {
    return {
      uptimeMs: Date.now() - this.#startedAt,
      requests: Object.fromEntries(this.#requests),
      errors: this.#errors,
      sseOpens: this.#sseOpens,
      snapshots: { ...this.#snapshots },
      recentEvents: this.#events.slice(-30),
      recentStages: this.#stages.slice(-20),
    }
  }

  #push(
    event: Omit<DiagnosticEventEntry, 'sequence' | 't'>,
  ): void {
    this.#events.push({ sequence: ++this.#sequence, t: Date.now(), ...event })
    if (this.#events.length > maxRecentEvents) this.#events.shift()
  }
}
