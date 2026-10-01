import { AsyncLocalStorage } from 'node:async_hooks'
import { isObject } from '../../../shared/is-object.ts'
import type {
  OperationEntry,
  OperationKind,
  OperationOrigin,
  OperationsSnapshot,
  OperationTotals,
  OperationTrigger,
} from '../../../shared/types.ts'

const maxRecentOperations = 100
const serializedRecentOperations = 40
/** Bounds aggregate maps against unbounded keys from client-chosen causes or command types. */
const maxAggregateKeys = 200
const overflowKey = 'other'
const backgroundLabel = 'background'
const causePattern = /^[A-Za-z0-9:_-]{1,64}$/
const routePattern = /^[A-Za-z0-9:_/.-]{1,120}$/
const detailPattern = /^[A-Za-z0-9_-]{1,40}$/
const operationKinds: readonly OperationKind[] = [
  'git',
  'manager-rpc',
  'session-store',
  'prompt-templates',
  'pi-rpc',
  'pi-process',
  'project-map',
]

/** Operations at or above this duration are written to the persistent sink. */
export const slowOperationThresholdMs = 1000
/** One request performing at least this many operations is reported as a fan-out. */
export const requestFanoutThreshold = 20
/** Burst window and per-kind operation counts that trigger one burst report per window. */
export const operationBurstWindowMs = 10_000
export const operationBurstThresholds: Readonly<Record<OperationKind, number>> = {
  'git': 40,
  'manager-rpc': 120,
  'session-store': 20,
  'prompt-templates': 20,
  'pi-rpc': 150,
  'pi-process': 6,
  'project-map': 5,
}

/** Attribution for every operation started while one request is being handled. */
export interface RequestOperationContext {
  readonly route: string
  readonly cause: string
  readonly startedAt: number
  operations: number
  readonly byKind: Partial<Record<OperationKind, number>>
}

/** Anomaly reports name the family `operation` because log lines reserve `kind`. */
export interface SlowOperationReport {
  operation: OperationKind
  detail: string
  route: string
  cause: string
  durationMs: number
  ok: boolean
  inFlight: number
}

export interface OperationBurstReport {
  operation: OperationKind
  count: number
  windowMs: number
  /** Up to three `route ← cause` triggers with the most operations in the window. */
  topTriggers: Array<{ trigger: string; operations: number }>
}

export interface RequestFanoutReport {
  route: string
  cause: string
  operations: number
  byKind: Partial<Record<OperationKind, number>>
  durationMs: number
}

/**
 * One anomaly as written to the app log (`type` becomes the log `kind`). The manager
 * forwards its anomalies to the backend in this shape as an `operation_anomaly` event.
 */
export type OperationAnomaly =
  | { type: 'slow-operation'; report: SlowOperationReport }
  | { type: 'operation-burst'; report: OperationBurstReport }
  | { type: 'request-fanout'; report: RequestFanoutReport }

/** Destination for anomalies: the backend's app log, or the manager's event stream. */
export type OperationAnomalySink = (anomaly: OperationAnomaly) => void

export interface OperationLedgerOptions {
  now?: () => number
  burstThresholds?: Readonly<Record<OperationKind, number>>
}

interface BurstWindow {
  startedAt: number
  count: number
  reported: boolean
  triggers: Map<string, number>
}

/**
 * Bounded, content-free ledger of expensive operations in one process: Git processes,
 * manager RPCs, session-file scans, and template reads in the backend; Pi processes, Pi
 * RPCs, and project scans in the manager. Each operation is attributed through
 * `AsyncLocalStorage` to the HTTP route template and frontend cause that started it (the
 * backend forwards both to the manager as the request `origin`), so a burst of Git
 * processes can be traced to the trigger that produced it. Aggregates stay in
 * memory; only anomalies — slow operations, per-kind bursts, and single requests that fan
 * out — reach the persistent sink. Entries never carry paths, arguments, or identifiers.
 */
export class OperationLedger {
  readonly #now: () => number
  readonly #burstThresholds: Readonly<Record<OperationKind, number>>
  readonly #context = new AsyncLocalStorage<RequestOperationContext>()
  readonly #totals = new Map<string, OperationTotals>()
  readonly #triggers = new Map<string, OperationTrigger>()
  readonly #inFlight = new Map<OperationKind, number>()
  readonly #bursts = new Map<OperationKind, BurstWindow>()
  #recent: OperationEntry[] = []
  #sequence = 0
  #sink: OperationAnomalySink | undefined

  constructor(options: OperationLedgerOptions = {}) {
    this.#now = options.now ?? (() => performance.now())
    this.#burstThresholds = options.burstThresholds ?? operationBurstThresholds
  }

  /** Routes anomalies to persistent storage; until set, they stay in memory only. */
  setSink(sink: OperationAnomalySink): void {
    this.#sink = sink
  }

  /** Creates the attribution for one request; unusable values become labels. */
  openRequest(route: string, causeHeader: string | string[] | undefined): RequestOperationContext {
    return {
      route: routePattern.test(route) ? route : 'invalid',
      cause: normalizeCause(causeHeader),
      startedAt: this.#now(),
      operations: 0,
      byKind: {},
    }
  }

  /** Runs request handling so that every nested operation is attributed to `context`. */
  runInRequest<T>(context: RequestOperationContext, handle: () => T): T {
    return this.#context.run(context, handle)
  }

  /** The request attribution to forward across a process boundary, if any. */
  currentOrigin(): OperationOrigin | undefined {
    const context = this.#context.getStore()
    return context ? { route: context.route, cause: context.cause } : undefined
  }

  /** Counts the finished request under its trigger and reports an excessive fan-out. */
  closeRequest(context: RequestOperationContext): void {
    if (context.operations === 0) return
    const trigger = boundedEntry(this.#triggers, triggerKey(context.route, context.cause), () => ({
      requests: 0,
      operations: 0,
    }))
    trigger.requests += 1
    if (context.operations < requestFanoutThreshold) return
    this.#sink?.({
      type: 'request-fanout',
      report: {
        route: context.route,
        cause: context.cause,
        operations: context.operations,
        byKind: { ...context.byKind },
        durationMs: Math.round(this.#now() - context.startedAt),
      },
    })
  }

  /** Measures one operation, attributing it to the current request when there is one. */
  async measure<T>(kind: OperationKind, detail: string, operation: () => Promise<T>): Promise<T> {
    const context = this.#context.getStore()
    const route = context?.route ?? backgroundLabel
    const cause = context?.cause ?? backgroundLabel
    const inFlight = (this.#inFlight.get(kind) ?? 0) + 1
    this.#inFlight.set(kind, inFlight)
    if (context) {
      context.operations += 1
      context.byKind[kind] = (context.byKind[kind] ?? 0) + 1
    } else {
      // Background work has no request to close, so it is counted as one per operation.
      boundedEntry(this.#triggers, triggerKey(route, cause), () => ({ requests: 0, operations: 0 }))
        .requests += 1
    }
    const trigger = triggerKey(route, cause)
    boundedEntry(this.#triggers, trigger, () => ({ requests: 0, operations: 0 })).operations += 1
    this.#countBurst(kind, trigger)

    const startedAt = this.#now()
    let ok = false
    try {
      const result = await operation()
      ok = true
      return result
    } finally {
      this.#inFlight.set(kind, (this.#inFlight.get(kind) ?? 1) - 1)
      this.#record({
        kind,
        detail,
        route,
        cause,
        durationMs: this.#now() - startedAt,
        ok,
        inFlight,
      })
    }
  }

  /** Serializes aggregates and the newest operations; bounded and content-free. */
  snapshotState(): OperationsSnapshot {
    let inFlight = 0
    for (const count of this.#inFlight.values()) inFlight += count
    return {
      inFlight,
      totals: Object.fromEntries(
        [...this.#totals].map((
          [key, totals],
        ) => [key, { ...totals, totalMs: Math.round(totals.totalMs) }]),
      ),
      triggers: Object.fromEntries(
        [...this.#triggers].map(([key, trigger]) => [key, { ...trigger }]),
      ),
      recent: this.#recent.slice(-serializedRecentOperations),
    }
  }

  #record(measurement: Omit<OperationEntry, 'sequence' | 't'>): void {
    const durationMs = Math.round(measurement.durationMs)
    const totals = boundedEntry(
      this.#totals,
      `${measurement.kind}:${measurement.detail}`,
      () => ({ count: 0, failures: 0, totalMs: 0, maxMs: 0 }),
    )
    totals.count += 1
    if (!measurement.ok) totals.failures += 1
    totals.totalMs += measurement.durationMs
    totals.maxMs = Math.max(totals.maxMs, durationMs)
    const entry = { sequence: ++this.#sequence, t: Date.now(), ...measurement, durationMs }
    this.#recent.push(entry)
    if (this.#recent.length > maxRecentOperations) this.#recent.shift()
    if (durationMs >= slowOperationThresholdMs) {
      this.#sink?.({
        type: 'slow-operation',
        report: {
          operation: entry.kind,
          detail: entry.detail,
          route: entry.route,
          cause: entry.cause,
          durationMs,
          ok: entry.ok,
          inFlight: entry.inFlight,
        },
      })
    }
  }

  #countBurst(kind: OperationKind, trigger: string): void {
    const now = this.#now()
    let window = this.#bursts.get(kind)
    if (!window || now - window.startedAt >= operationBurstWindowMs) {
      window = { startedAt: now, count: 0, reported: false, triggers: new Map() }
      this.#bursts.set(kind, window)
    }
    window.count += 1
    boundedCount(window.triggers, trigger)
    if (window.reported || window.count < this.#burstThresholds[kind]) return
    window.reported = true
    this.#sink?.({
      type: 'operation-burst',
      report: {
        operation: kind,
        count: window.count,
        windowMs: operationBurstWindowMs,
        topTriggers: [...window.triggers]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 3)
          .map(([key, operations]) => ({ trigger: key, operations })),
      },
    })
  }
}

/** Process-wide ledger: one in the backend, a separate one in the manager. */
export const operationLedger = new OperationLedger()

/**
 * Measures one expensive operation in the process-wide ledger. Use it at the narrowest
 * owning chokepoint (one per spawned process, RPC, or file scan) and pass only a
 * content-free `detail`: never paths, arguments, messages, or identifiers.
 */
export function measureOperation<T>(
  kind: OperationKind,
  detail: string,
  operation: () => Promise<T>,
): Promise<T> {
  return operationLedger.measure(kind, detail, operation)
}

/**
 * Converts a request path into a content-free template: drops `/api/`, masks session and
 * instance identifiers, and keeps fixed collection routes such as `sessions/recent`.
 */
export function operationRouteTemplate(pathname: string): string {
  return pathname
    .replace(/^\/api\//, '')
    .replace(/sessions\/[^/]+(?=\/)/, 'sessions/:id')
    .replace(/instances\/[^/]+/, 'instances/:id')
}

/**
 * Names an operation from a value that may come from outside the process (a Pi command
 * type from the browser): only short identifier-shaped values are kept verbatim.
 */
export function safeOperationDetail(value: unknown): string {
  return typeof value === 'string' && detailPattern.test(value) ? value : 'other'
}

/** Reads a forwarded request origin; anything malformed is treated as absent. */
export function parseOperationOrigin(value: unknown): OperationOrigin | undefined {
  return isObject(value) && typeof value.route === 'string' && typeof value.cause === 'string'
    ? { route: value.route, cause: value.cause }
    : undefined
}

/**
 * Validates an anomaly received from the manager and rebuilds it from known fields only,
 * so the app log never stores unexpected content from across the process boundary.
 */
export function parseOperationAnomaly(value: unknown): OperationAnomaly | undefined {
  if (!isObject(value) || !isObject(value.report)) return undefined
  const report = value.report
  if (value.type === 'slow-operation') {
    if (
      !isOperationKind(report.operation) || !isLabel(report.detail) || !isLabel(report.route)
      || !isLabel(report.cause) || !isCount(report.durationMs) || typeof report.ok !== 'boolean'
      || !isCount(report.inFlight)
    ) return undefined
    return {
      type: value.type,
      report: {
        operation: report.operation,
        detail: report.detail,
        route: report.route,
        cause: report.cause,
        durationMs: report.durationMs,
        ok: report.ok,
        inFlight: report.inFlight,
      },
    }
  }
  if (value.type === 'operation-burst') {
    if (
      !isOperationKind(report.operation) || !isCount(report.count) || !isCount(report.windowMs)
      || !Array.isArray(report.topTriggers)
    ) return undefined
    const topTriggers = report.topTriggers.slice(0, 3).flatMap((trigger: unknown) =>
      isObject(trigger) && isLabel(trigger.trigger) && isCount(trigger.operations)
        ? [{ trigger: trigger.trigger, operations: trigger.operations }]
        : []
    )
    return {
      type: value.type,
      report: {
        operation: report.operation,
        count: report.count,
        windowMs: report.windowMs,
        topTriggers,
      },
    }
  }
  if (value.type === 'request-fanout') {
    if (
      !isLabel(report.route) || !isLabel(report.cause) || !isCount(report.operations)
      || !isCount(report.durationMs) || !isObject(report.byKind)
    ) return undefined
    const byKind: Partial<Record<OperationKind, number>> = {}
    for (const kind of operationKinds) {
      const count = report.byKind[kind]
      if (isCount(count)) byKind[kind] = count
    }
    return {
      type: value.type,
      report: {
        route: report.route,
        cause: report.cause,
        operations: report.operations,
        byKind,
        durationMs: report.durationMs,
      },
    }
  }
  return undefined
}

function isOperationKind(value: unknown): value is OperationKind {
  return operationKinds.includes(value as OperationKind)
}

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalizeCause(header: string | string[] | undefined): string {
  if (header === undefined) return 'unspecified'
  const value = Array.isArray(header) ? header[0] : header
  return value !== undefined && causePattern.test(value) ? value : 'invalid'
}

function triggerKey(route: string, cause: string): string {
  return `${route} ← ${cause}`
}

function boundedEntry<T>(map: Map<string, T>, key: string, create: () => T): T {
  const resolvedKey = map.has(key) || map.size < maxAggregateKeys ? key : overflowKey
  let value = map.get(resolvedKey)
  if (value === undefined) {
    value = create()
    map.set(resolvedKey, value)
  }
  return value
}

function boundedCount(map: Map<string, number>, key: string): void {
  const resolvedKey = map.has(key) || map.size < maxAggregateKeys ? key : overflowKey
  map.set(resolvedKey, (map.get(resolvedKey) ?? 0) + 1)
}
