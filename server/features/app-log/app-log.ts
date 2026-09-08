import type { ClientLogRequestBody, ClientLogSource } from '../../../shared/types.ts'

import { appendFileSync, closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'

/** Tail window used to find the previous run's last log line without reading the whole file. */
const previousRunTailBytes = 4096

/** Client entries retained per run; further entries are counted and reported once. */
export const appLogClientEntryCap = 500

export const appLogMaxMessageLength = 300
export const appLogMaxStackLength = 2000

/** Snapshots slower than this are logged as slow-snapshot entries. */
export const slowSnapshotThresholdMs = 1000

export interface AppLogPreviousRun {
  uptimeMs: number
  clean: boolean
}

/**
 * Parses the previous run's outcome from the last log line: a `shutdown` line reports a
 * known uptime (clean only when the reason is `exit`); anything else, including a torn
 * final line, means the run ended abruptly or the file is new or unreadable.
 */
export function parsePreviousRun(tail: string): AppLogPreviousRun | undefined {
  const lastLine = tail.split('\n').filter((line) => line.trim() !== '').at(-1)
  if (lastLine === undefined) return undefined
  try {
    const value: unknown = JSON.parse(lastLine)
    if (isObject(value) && value.kind === 'shutdown' && typeof value.uptimeMs === 'number') {
      return { uptimeMs: value.uptimeMs, clean: value.reason === 'exit' }
    }
  } catch {
    // A corrupt or torn tail line means the previous run ended abruptly.
  }
  return undefined
}

/**
 * Append-only JSONL log for post-hoc stability analysis. Entries are bounded and
 * content-free: no prompts, payloads, or session identifiers (routes keep the
 * `sessions/:id` template). The file grows without rotation by explicit decision;
 * revisit when size matters. Writes are synchronous and failures are swallowed so
 * logging can never take the backend down.
 */
export class AppLog {
  readonly #path: string
  readonly #startedAt = Date.now()
  #clientEntries = 0
  #clientCapReported = false
  #shutdownWritten = false

  constructor(path: string) {
    this.#path = path
  }

  /** Records backend startup and what is known about the previous run. */
  boot(pid: number): void {
    this.#write('boot', { pid, previousRun: this.#readPreviousRun() ?? 'unknown' })
  }

  /**
   * Records the run ending. `exit` is the normal path; `crash` is written from the
   * uncaught-exception handler before the process dies. Only the first call writes.
   */
  shutdown(reason: 'exit' | 'crash'): void {
    if (this.#shutdownWritten) return
    this.#shutdownWritten = true
    this.#write('shutdown', { reason, uptimeMs: Date.now() - this.#startedAt })
  }

  /** Records an uncaught exception or unhandled rejection. */
  uncaught(source: 'uncaughtException' | 'unhandledRejection', error: unknown): void {
    this.#write('uncaught', {
      source,
      message: truncate(
        error instanceof Error ? error.message : String(error),
        appLogMaxMessageLength,
      ),
      stack: truncate(
        error instanceof Error && error.stack ? error.stack : '',
        appLogMaxStackLength,
      ),
    })
  }

  /** Records one failed HTTP request; the route stays a template without identifiers. */
  requestError(route: string, status: number): void {
    this.#write('request-error', { route, status })
  }

  /** Records a manager connection state change. */
  manager(state: 'connected' | 'disconnected'): void {
    this.#write('manager', { state })
  }

  /** Records an SSE stream opening (page loads and reconnects). */
  sseOpen(): void {
    this.#write('sse-open', {})
  }

  /** Records one snapshot slower than `slowSnapshotThresholdMs`. */
  slowSnapshot(mode: 'full' | 'delta', totalMs: number, bytes: number): void {
    this.#write('slow-snapshot', { mode, totalMs, bytes })
  }

  /**
   * Records one client-reported entry. Beyond the per-run cap, entries are counted and
   * a single `client-cap` marker is written. Returns whether the entry was logged.
   */
  client(body: ClientLogRequestBody): boolean {
    if (this.#clientEntries >= appLogClientEntryCap) {
      if (!this.#clientCapReported) {
        this.#clientCapReported = true
        this.#write('client-cap', {
          note: 'client entry cap reached; further entries suppressed this run',
        })
      }
      return false
    }
    this.#clientEntries += 1
    this.#write('client', {
      source: body.source,
      message: truncate(body.message, appLogMaxMessageLength),
    })
    return true
  }

  #readPreviousRun(): AppLogPreviousRun | undefined {
    if (!existsSync(this.#path)) return undefined
    const handle = openSync(this.#path, 'r')
    try {
      const size = statSync(this.#path).size
      const start = Math.max(0, size - previousRunTailBytes)
      const buffer = Buffer.alloc(size - start)
      readSync(handle, buffer, 0, buffer.length, start)
      return parsePreviousRun(buffer.toString('utf8'))
    } catch {
      return undefined
    } finally {
      closeSync(handle)
    }
  }

  #write(kind: string, fields: Record<string, unknown>): void {
    try {
      appendFileSync(this.#path, `${JSON.stringify({ t: Date.now(), kind, ...fields })}\n`)
    } catch {
      // Logging must never break the backend; a failed append is silently dropped.
    }
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export type { ClientLogSource }
