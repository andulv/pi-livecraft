import { spawn as spawnPtyProcess } from '@lydell/node-pty'
import type { TerminalSessionState, TerminalSessionStatus } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'

/** Replay buffer target; the oldest whole chunks drop first. */
const replayBufferTargetBytes = 256 * 1024
/** Merge window that coalesces PTY bursts into fewer SSE events. */
const flushWindowMs = 8
/** Pending-output levels at which the PTY pauses and resumes producing bytes. */
const highWatermarkBytes = 512 * 1024
const lowWatermarkBytes = 128 * 1024
const defaultCols = 80
const defaultRows = 24
/** Longest forwarded input payload, matching the browser pane's paste cap. */
const maxInputLength = 10_000
/** Upper bounds that keep a resize request from wedging the PTY. */
const maxCols = 1000
const maxRows = 1000
/** Concurrent sessions allowed per workspace; the pane uses a single one. */
const maxSessionsPerWorkspace = 4

const terminalIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

/** Validates the opaque terminal ID used in scoped API routes. */
export function parseTerminalId(value: unknown): string | null {
  return typeof value === 'string' && terminalIdPattern.test(value) ? value : null
}

/** Validates an untrusted input payload into a bounded string. */
export function parseTerminalInput(value: unknown): string | null {
  if (!isObject(value) || typeof value.data !== 'string') return null
  return value.data.length > 0 && value.data.length <= maxInputLength ? value.data : null
}

/** Validates an untrusted resize payload into bounded positive integers. */
export function parseTerminalResize(value: unknown): { cols: number; rows: number } | null {
  if (!isObject(value)) return null
  const cols = value.cols
  const rows = value.rows
  if (
    typeof cols !== 'number' || typeof rows !== 'number'
    || !Number.isInteger(cols) || !Number.isInteger(rows)
    || cols < 1 || cols > maxCols || rows < 1 || rows > maxRows
  ) return null
  return { cols, rows }
}

/** One whole output chunk at a known stream offset. */
export interface TerminalChunk {
  /** Stream offset of the chunk's first byte. */
  start: number
  bytes: Buffer
}

/** Size-capped ring of whole output chunks; a replay never begins mid-chunk. */
export class TerminalChunkBuffer {
  readonly #targetBytes: number
  #chunks: TerminalChunk[] = []
  #totalBytes = 0
  #endOffset = 0

  constructor(targetBytes: number = replayBufferTargetBytes) {
    this.#targetBytes = targetBytes
  }

  /** Appends one chunk and drops the oldest whole chunks while over target. */
  push(bytes: Buffer): TerminalChunk {
    const chunk: TerminalChunk = { start: this.#endOffset, bytes }
    this.#endOffset += bytes.length
    this.#totalBytes += bytes.length
    this.#chunks.push(chunk)
    // A single oversized chunk stays whole; the cap is enforced across chunks.
    while (this.#chunks.length > 1 && this.#totalBytes > this.#targetBytes) {
      const dropped = this.#chunks.shift()
      if (!dropped) break
      this.#totalBytes -= dropped.bytes.length
    }
    return chunk
  }

  /** Chunks a reconnecting subscriber should receive after the exclusive offset. */
  resumeAfter(lastEventId?: number): TerminalChunk[] {
    if (lastEventId === undefined) return [...this.#chunks]
    return this.#chunks.filter((chunk) => chunk.start + chunk.bytes.length > lastEventId)
  }

  /** Cumulative stream offset after the newest buffered chunk. */
  get endOffset(): number {
    return this.#endOffset
  }

  /** Total buffered bytes across all chunks. */
  get totalBytes(): number {
    return this.#totalBytes
  }
}

/** Result of a flow-control evaluation: apply a PTY pause, a resume, or nothing. */
export type FlowTransition = 'pause' | 'resume' | null

/**
 * Hysteresis gate deciding whether the PTY should pause producing output.
 * Pauses past the high watermark or while a subscriber is congested; resumes
 * only below the low watermark with every socket drained again.
 */
export class WatermarkGate {
  readonly #high: number
  readonly #low: number
  #paused = false
  #pendingBytes = 0
  #blockedSubscribers = 0

  constructor(high: number = highWatermarkBytes, low: number = lowWatermarkBytes) {
    this.#high = high
    this.#low = low
  }

  /** Records PTY output waiting to be flushed; pauses past the high mark. */
  noteProduced(bytes: number): FlowTransition {
    this.#pendingBytes += bytes
    if (!this.#paused && this.#pendingBytes > this.#high) {
      this.#paused = true
      return 'pause'
    }
    return null
  }

  /** Records a flush; resumes below the low mark once nothing is congested. */
  noteFlushed(bytes: number): FlowTransition {
    this.#pendingBytes = Math.max(0, this.#pendingBytes - bytes)
    return this.#resumeWhenIdle()
  }

  /** Records a congested subscriber; pauses until its socket drains. */
  noteBlocked(): FlowTransition {
    this.#blockedSubscribers++
    if (!this.#paused) {
      this.#paused = true
      return 'pause'
    }
    return null
  }

  /** Records a drained socket; resumes only below the low mark. */
  noteUnblocked(): FlowTransition {
    this.#blockedSubscribers = Math.max(0, this.#blockedSubscribers - 1)
    return this.#resumeWhenIdle()
  }

  /** Whether the gate currently asks the PTY to stay paused. */
  get paused(): boolean {
    return this.#paused
  }

  #resumeWhenIdle(): FlowTransition {
    if (this.#paused && this.#blockedSubscribers === 0 && this.#pendingBytes < this.#low) {
      this.#paused = false
      return 'resume'
    }
    return null
  }
}

/** Serializes one output chunk into its SSE event; computed once per chunk. Pure. */
export function wireOutputChunk(chunk: TerminalChunk): {
  name: 'output'
  json: string
  id: number
} {
  return {
    name: 'output',
    json: JSON.stringify({ data: chunk.bytes.toString('base64') }),
    id: chunk.start + chunk.bytes.length,
  }
}

/** Serializes a status payload into its SSE event. Pure. */
export function wireTerminalStatus(status: TerminalSessionStatus): {
  name: 'status'
  json: string
} {
  return { name: 'status', json: JSON.stringify(status) }
}

/** Minimal PTY surface the session needs; satisfied by the PTY addon and test doubles. */
export interface TerminalPty {
  readonly process: string
  write(data: string): void
  resize(columns: number, rows: number): void
  pause(): void
  resume(): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void
  }
}

/** Spawn request resolved by the owning route: the validated workspace directory. */
export interface PtySpawnOptions {
  cwd: string
  cols: number
  rows: number
  env: Record<string, string>
}

export type PtySpawner = (options: PtySpawnOptions) => TerminalPty

/** Builds the spawn environment: explicit color capabilities plus a UTF-8 locale. */
export function terminalEnvironment(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value
  }
  // Without TERM the shell assumes a dumb terminal; colors and TUI apps break.
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  // Fill only a missing locale; an existing one stays untouched.
  if (!env.LANG) env.LANG = 'en_US.UTF-8'
  return env
}

/** Picks the platform shell: `$SHELL` (or bash) on Unix, PowerShell on Windows. */
function platformShellCommand(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: [] }
  const shell = process.env.SHELL?.trim()
  return { file: shell ? shell : 'bash', args: [] }
}

/** Default spawner: the platform shell with the route-validated working directory. */
export function defaultPtySpawner(options: PtySpawnOptions): TerminalPty {
  const shell = platformShellCommand()
  return spawnPtyProcess(shell.file, shell.args, {
    name: 'xterm-256color',
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    env: options.env,
  })
}

/** Receives serialized terminal events; `id` is present only for output events. */
export type TerminalSubscriber = (
  event: 'output' | 'status',
  json: string,
  id?: number,
) => void

export interface TerminalSubscription {
  unsubscribe(): void
  /** Reports SSE socket backpressure so the PTY can pause. */
  setCongested(blocked: boolean): void
}

/** Owns one embedded shell process, its output ring, and pane fan-out. */
export class TerminalSession {
  readonly #workspacePath: string
  readonly #spawnPty: PtySpawner
  #state: TerminalSessionState = 'off'
  #error: string | undefined
  #shell: string | undefined
  #pty: TerminalPty | null = null
  #ptyDisposables: Array<{ dispose(): void }> = []
  #cols = defaultCols
  #rows = defaultRows
  #buffer = new TerminalChunkBuffer()
  #gate = new WatermarkGate()
  #subscribers = new Map<TerminalSubscriber, { congested: boolean }>()
  #pending: Buffer[] = []
  #flushTimer: ReturnType<typeof setTimeout> | null = null
  #startPromise: Promise<TerminalSessionStatus> | null = null
  #stopping = false

  constructor(
    options: { workspacePath: string; spawnPty?: PtySpawner } = { workspacePath: '' },
  ) {
    this.#workspacePath = options.workspacePath
    this.#spawnPty = options.spawnPty ?? defaultPtySpawner
  }

  status(): TerminalSessionStatus {
    return {
      state: this.#state,
      cols: this.#cols,
      rows: this.#rows,
      ...(this.#shell === undefined ? {} : { shell: this.#shell }),
      ...(this.#error === undefined ? {} : { error: this.#error }),
    }
  }

  /** Starts (or restarts) the shell; safe to call concurrently and repeatedly. */
  start(): Promise<TerminalSessionStatus> {
    if (this.#state === 'live' || this.#state === 'starting') {
      return Promise.resolve(this.status())
    }
    if (this.#startPromise) return this.#startPromise
    this.#startPromise = this.#start().finally(() => {
      this.#startPromise = null
    })
    return this.#startPromise
  }

  async #start(): Promise<TerminalSessionStatus> {
    this.#teardown()
    // A restarted shell is a new epoch: offsets reset and stale scrollback drops.
    this.#buffer = new TerminalChunkBuffer()
    this.#error = undefined
    this.#stopping = false
    this.#setState('starting')
    try {
      const pty = this.#spawnPty({
        cwd: this.#workspacePath,
        cols: this.#cols,
        rows: this.#rows,
        env: terminalEnvironment(process.env),
      })
      this.#pty = pty
      this.#shell = pty.process
      this.#ptyDisposables = [
        pty.onData((data) => this.#onPtyData(data)),
        pty.onExit((event) => this.#onPtyExit(event.exitCode, event.signal)),
      ]
      this.#setState('live')
      return this.status()
    } catch (error) {
      this.#teardown()
      this.#error = errorMessage(error)
      this.#setState('crashed')
      throw error
    }
  }

  /** Stops the shell; a later start spawns a fresh one. Repeated calls are safe. */
  stop(): void {
    this.#stopping = true
    this.#teardown()
    this.#setState('off')
  }

  /** Forwards typed bytes into the PTY. */
  write(data: string): void {
    this.#pty?.write(data)
  }

  /** Resizes the PTY and reports the new geometry; remembered across restarts. */
  resize(cols: number, rows: number): void {
    this.#cols = cols
    this.#rows = rows
    this.#pty?.resize(cols, rows)
    this.#emitStatus()
  }

  subscribe(subscriber: TerminalSubscriber): TerminalSubscription {
    const record = { congested: false }
    this.#subscribers.set(subscriber, record)
    return {
      unsubscribe: () => {
        if (this.#subscribers.delete(subscriber) && record.congested) {
          this.#applyGate(this.#gate.noteUnblocked())
        }
      },
      setCongested: (blocked) => {
        if (record.congested === blocked) return
        record.congested = blocked
        this.#applyGate(blocked ? this.#gate.noteBlocked() : this.#gate.noteUnblocked())
      },
    }
  }

  /**
   * Wire-ready events a connecting subscriber should receive before live output:
   * the current status, then buffered chunks after the exclusive resume offset.
   */
  replay(lastEventId?: number): Array<{ name: 'output' | 'status'; json: string; id?: number }> {
    return [
      { name: 'status', json: wireTerminalStatus(this.status()).json },
      ...this.#buffer.resumeAfter(lastEventId).map((chunk) => {
        const wired = wireOutputChunk(chunk)
        return { name: wired.name, json: wired.json, id: wired.id }
      }),
    ]
  }

  /** Synchronous last-resort cleanup for backend exit. */
  killSync(): void {
    this.#pty?.kill('SIGKILL')
  }

  #onPtyData(data: string): void {
    if (this.#state !== 'live') return
    const bytes = Buffer.from(data, 'utf8')
    if (bytes.length === 0) return
    this.#pending.push(bytes)
    if (this.#flushTimer === null) {
      this.#flushTimer = setTimeout(() => {
        this.#flushTimer = null
        this.#flush()
      }, flushWindowMs)
    }
    this.#applyGate(this.#gate.noteProduced(bytes.length))
  }

  #flush(): void {
    if (this.#pending.length === 0) return
    const bytes = Buffer.concat(this.#pending)
    this.#pending = []
    const wired = wireOutputChunk(this.#buffer.push(bytes))
    for (const subscriber of this.#subscribers.keys()) {
      subscriber(wired.name, wired.json, wired.id)
    }
    this.#applyGate(this.#gate.noteFlushed(bytes.length))
  }

  #onPtyExit(exitCode: number, signal: number | undefined): void {
    this.#ptyDisposables = []
    this.#pty = null
    if (this.#stopping) return
    // Linux PTYs report signal 0 on a normal exit; only a real signal is a crash.
    if (signal !== undefined && signal !== 0) {
      this.#error = `The shell was terminated (signal ${signal})`
      this.#setState('crashed')
      return
    }
    this.#error = exitCode === 0 ? undefined : `The shell exited with code ${exitCode}`
    this.#setState('exited')
  }

  #applyGate(transition: FlowTransition): void {
    if (transition === 'pause') this.#pty?.pause()
    if (transition === 'resume') this.#pty?.resume()
  }

  #teardown(): void {
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer)
      this.#flushTimer = null
    }
    for (const disposable of this.#ptyDisposables) disposable.dispose()
    this.#ptyDisposables = []
    const pty = this.#pty
    this.#pty = null
    if (pty) {
      try {
        pty.kill()
      } catch {
        // The process is already gone.
      }
    }
    this.#pending = []
  }

  #setState(state: TerminalSessionState): void {
    this.#state = state
    this.#emitStatus()
  }

  #emitStatus(): void {
    const wired = wireTerminalStatus(this.status())
    for (const subscriber of this.#subscribers.keys()) subscriber(wired.name, wired.json)
  }
}

/** Owns terminal sessions grouped by canonical workspace path. */
export class TerminalService {
  readonly #workspaces = new Map<string, Map<string, TerminalSession>>()

  /**
   * Returns the stable session object for one workspace and terminal ID,
   * or null when the workspace already holds the session cap.
   */
  session(workspacePath: string, terminalId: string): TerminalSession | null {
    let workspace = this.#workspaces.get(workspacePath)
    if (!workspace) {
      workspace = new Map()
      this.#workspaces.set(workspacePath, workspace)
    }
    const existing = workspace.get(terminalId)
    if (existing) return existing
    if (workspace.size >= maxSessionsPerWorkspace) return null
    const session = new TerminalSession({ workspacePath })
    workspace.set(terminalId, session)
    return session
  }

  /** Synchronous last-resort cleanup for backend exit. */
  killSync(): void {
    for (const workspace of this.#workspaces.values()) {
      for (const session of workspace.values()) session.killSync()
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
