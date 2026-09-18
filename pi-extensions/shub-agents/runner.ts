/**
 * Runs one shub-agent child: a bounded, one-shot `pi --mode json --print`
 * process.
 *
 * The child persists a normal Pi session in the workspace session directory, so
 * every run stays inspectable and its cost stays attributable after the tool
 * call is gone. This file knows no agent names or profile locations: it accepts
 * only a resolved run specification. Ownership is unchanged by this file —
 * children are one-shot non-RPC processes, and `server/manager.ts` remains the
 * sole owner of `pi --mode rpc` processes.
 *
 * Argument assembly and event extraction are exported separately from the spawn
 * so both can be tested without starting a process.
 */
import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isObject } from '../../shared/is-object.ts'
import { workspaceSessionFolderName } from '../../shared/pi-session-paths.ts'

const MAX_RAW_EVENT_TAIL_CHARS = 50_000
/** Partial assistant text is accumulated tail-only for bounded failure diagnostics. */
const MAX_OUTPUT_CHARS = 100_000
const MAX_PARTIAL_EVIDENCE_CHARS = 20_000
const MAX_EVIDENCE_ITEM_CHARS = 2_000
const PROGRESS_THROTTLE_MS = 300
const FORCE_KILL_DELAY_MS = 5_000
/** Extra wait after force-kill before rejecting, in case the process ignores everything. */
const SETTLE_DELAY_MS = 1_000

export interface ShubChildOptions {
  piExecutable: string
  /** Extension entry files loaded into the child; the child is otherwise extension-free. */
  extensions: string[]
  /** Allowlist passed to `--tools`; the declared tools are the child's whole capability. */
  tools: string[]
  /** Extra CLI flags owned by the host, never by a profile (e.g. FFF mode flags). */
  providerArgs?: string[]
  /** Extra environment owned by the host (e.g. FFF mode settings). */
  providerEnv?: Record<string, string>
  cwd: string
  task: string
  /** Absolute image paths passed as `@path` so a vision model reads them. */
  images: string[]
  /** Pi session id of the owning parent session, passed to the session marker. */
  ownerSessionId?: string
  /** Agent name, passed to the session marker and shown in progress text. */
  agentName?: string
  sessionName: string
  systemPrompt: string
  /** Empty string omits `--model` and leaves model selection to the child config. */
  model?: string
  thinking: string
  effort: string
  softToolCalls: number
  hardToolCalls: number
  timeoutMs: number
  maxOutputChars: number
  signal?: AbortSignal
  onProgress?: (progress: ShubProgress) => void
}

/** Live state of a running child, reported to the parent tool card. */
export interface ShubProgress {
  text: string
  sessionId?: string
  turnCount: number
  toolCount: number
  completedToolCount: number
  lastTool?: string
  totalTokens: number
  contextTokens: number
  costUsd: number
  elapsedMs: number
}

export interface ShubChildResult {
  code: number | null
  text: string
  stderr: string
  /** True when the run failed without producing a report and the failure looks
   *  provider-shaped (model call or startup failed), i.e. worth retrying on the
   *  next model of the agent's list. */
  providerError: boolean
  sessionId?: string
  turnCount: number
  toolCount: number
  totalTokens: number
  contextTokens: number
  costUsd: number
  elapsedMs: number
}

/**
 * Builds the child command line. `--no-extensions` is both the isolation guard
 * and the recursion guard: without it the child would load the user's global
 * extension list, including shub-agents itself. `--no-session` is deliberately
 * absent so the run persists.
 */
export function shubChildArguments(
  options: Pick<
    ShubChildOptions,
    | 'extensions'
    | 'tools'
    | 'task'
    | 'images'
    | 'sessionName'
    | 'systemPrompt'
    | 'model'
    | 'thinking'
    | 'providerArgs'
  >,
): string[] {
  const args = [
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-context-files',
    '--mode',
    'json',
    '--name',
    options.sessionName,
  ]
  for (const extension of options.extensions) args.push('--extension', extension)
  args.push(...(options.providerArgs ?? []))
  args.push('--tools', options.tools.join(','))
  args.push('--system-prompt', options.systemPrompt)
  if (options.model) args.push('--model', options.model)
  args.push('--thinking', options.thinking)
  args.push('--print', ...options.images.map((image) => `@${image}`), options.task)
  return args
}

/** Accumulated state of one child, updated from its JSON event stream. */
export interface ShubStream {
  sessionId?: string
  turnCount: number
  toolCount: number
  completedToolCount: number
  lastTool?: string
  totalTokens: number
  /** Input context size on the last assistant message; overwritten per message. */
  contextTokens: number
  costUsd: number
  /** The final assistant message from `turn_end`; this is the only answer returned to the parent. */
  output: string
  /** Tail of intermediate assistant text, used only as partial evidence after a timeout. */
  partialOutput: string
  /** Tail of completed tool results, used as partial evidence after a timeout. */
  evidence: string
}

export function createShubStream(): ShubStream {
  return {
    turnCount: 0,
    toolCount: 0,
    completedToolCount: 0,
    totalTokens: 0,
    contextTokens: 0,
    costUsd: 0,
    output: '',
    partialOutput: '',
    evidence: '',
  }
}

/**
 * Applies one JSON event line to the stream state and reports what changed, so
 * the caller decides whether the change is worth a progress update.
 */
export function applyShubEvent(
  stream: ShubStream,
  line: string,
): 'session' | 'turn' | 'tool' | 'answer' | undefined {
  if (!line.trim()) return undefined
  let event: unknown
  try {
    event = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isObject(event)) return undefined

  if (event.type === 'session' && typeof event.id === 'string') {
    stream.sessionId = event.id
    return 'session'
  }
  if (event.type === 'turn_start') {
    stream.turnCount++
    return 'turn'
  }
  if (event.type === 'tool_execution_start') {
    stream.toolCount++
    stream.lastTool = typeof event.toolName === 'string' ? event.toolName : 'tool'
    return 'tool'
  }
  if (event.type === 'tool_execution_end') {
    stream.completedToolCount++
    const evidence = contentText(event.result).trim()
    if (evidence) {
      const label = typeof event.toolName === 'string' ? event.toolName : stream.lastTool ?? 'tool'
      const item = `\n\n[${label}]\n${evidence.slice(0, MAX_EVIDENCE_ITEM_CHARS)}`
      stream.evidence = (stream.evidence + item).slice(-MAX_PARTIAL_EVIDENCE_CHARS)
    }
    return 'tool'
  }
  if (event.type === 'message_end' && isObject(event.message)) {
    if (event.message.role !== 'assistant') return undefined
    applyUsage(stream, event.message.usage)
    const text = contentText(event.message).trim()
    if (text) {
      stream.partialOutput = stream.partialOutput ? `${stream.partialOutput}\n\n${text}` : text
      // Keep only the tail so intermediate output stays bounded in memory.
      if (stream.partialOutput.length > MAX_OUTPUT_CHARS) {
        stream.partialOutput = stream.partialOutput.slice(-MAX_OUTPUT_CHARS)
      }
    }
    return undefined
  }
  if (event.type === 'turn_end' && isObject(event.message) && event.message.role === 'assistant') {
    // A turn may contain several assistant messages around tool calls. Only the
    // authoritative turn-end message is the report; earlier messages are model
    // scratch work and stay out of the parent conversation.
    stream.output = contentText(event.message).trim().slice(0, MAX_OUTPUT_CHARS)
    return 'answer'
  }
  return undefined
}

/** Sums completed assistant messages only; streaming usage is cumulative per message. */
function applyUsage(stream: ShubStream, usage: unknown): void {
  if (!isObject(usage)) return
  if (typeof usage.totalTokens === 'number') stream.totalTokens += usage.totalTokens
  const inputContext = (typeof usage.input === 'number' ? usage.input : 0)
    + (typeof usage.cacheRead === 'number' ? usage.cacheRead : 0)
    + (typeof usage.cacheWrite === 'number' ? usage.cacheWrite : 0)
  if (inputContext > 0) stream.contextTokens = inputContext
  const cost = usage.cost
  if (isObject(cost) && typeof cost.total === 'number') stream.costUsd += cost.total
}

function contentText(value: unknown): string {
  if (!isObject(value) || !Array.isArray(value.content)) return ''
  return value
    .content
    .filter((part): part is { type: 'text'; text: string } =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('')
}

/**
 * Locates the session file Pi created for this run. Pi names session files
 * `<timestamp>_<id>.jsonl`, so the id from the event stream identifies the file
 * without guessing the timestamp. The search starts from the parent's own
 * session file, which is the one place the child's storage root is known for
 * certain: sessions live in `<root>/<workspace folder>/`.
 */
export async function findShubSessionPath(
  cwd: string,
  sessionId: string,
  parentSessionFile: string | undefined,
): Promise<string | undefined> {
  if (!parentSessionFile) return undefined
  const directory = join(dirname(dirname(parentSessionFile)), workspaceSessionFolderName(cwd))
  try {
    const entries = await readdir(directory)
    const match = entries.find((entry) => entry.endsWith(`${sessionId}.jsonl`))
    return match ? join(directory, match) : undefined
  } catch {
    return undefined
  }
}

/**
 * Spawns the child and resolves once it exits. A timeout or an aborted parent
 * turn terminates the process group and rejects only after the child has
 * actually settled, with whatever evidence it had already produced; the
 * persisted session keeps the rest.
 */
export function runShubChild(options: ShubChildOptions): Promise<ShubChildResult> {
  if (options.signal?.aborted) return Promise.reject(new Error('shub-agent cancelled.'))
  const args = shubChildArguments(options)
  const startedAt = Date.now()

  return new Promise<ShubChildResult>((resolvePromise, reject) => {
    const child = spawn(options.piExecutable, args, {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PI_SKIP_VERSION_CHECK: '1',
        PI_SHUB_OWNER_SESSION_ID: options.ownerSessionId ?? '',
        PI_SHUB_AGENT: options.agentName ?? '',
        PI_SHUB_SOFT_TOOL_CALLS: String(options.softToolCalls),
        PI_SHUB_HARD_TOOL_CALLS: String(options.hardToolCalls),
        ...(options.providerEnv ?? {}),
      },
    })

    const stream = createShubStream()
    let rawEventTail = ''
    let stderr = ''
    let lineBuffer = ''
    let settled = false
    let closed = false
    let lastProgressAt = 0
    let pendingProgress: string | undefined
    let progressTimer: ReturnType<typeof setTimeout> | undefined
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    /** Set once termination begins; the promise rejects only after the child settles. */
    let pendingFailure: (() => Error) | undefined

    const killProcessGroup = (signal: NodeJS.Signals): void => {
      if (closed) return
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, signal)
          return
        } catch {
          // The group is already gone; fall through to the direct kill.
        }
      }
      child.kill(signal)
    }

    const sendProgress = (text: string): void => {
      lastProgressAt = Date.now()
      options.onProgress?.({
        text,
        sessionId: stream.sessionId,
        turnCount: stream.turnCount,
        toolCount: stream.toolCount,
        completedToolCount: stream.completedToolCount,
        lastTool: stream.lastTool,
        totalTokens: stream.totalTokens,
        contextTokens: stream.contextTokens,
        costUsd: stream.costUsd,
        elapsedMs: Date.now() - startedAt,
      })
    }

    const emitProgress = (text: string, immediate = false): void => {
      if (settled || !options.onProgress) return
      const elapsed = Date.now() - lastProgressAt
      if (immediate || elapsed >= PROGRESS_THROTTLE_MS) {
        if (progressTimer) clearTimeout(progressTimer)
        progressTimer = undefined
        pendingProgress = undefined
        sendProgress(text)
        return
      }
      pendingProgress = text
      if (!progressTimer) {
        progressTimer = setTimeout(() => {
          progressTimer = undefined
          const pending = pendingProgress
          pendingProgress = undefined
          if (pending && !settled) sendProgress(pending)
        }, PROGRESS_THROTTLE_MS - elapsed)
      }
    }

    const processLine = (line: string): void => {
      const change = applyShubEvent(stream, line)
      if (!change) return
      if (change === 'session' || change === 'answer')
        emitProgress(progressText(stream, options), true)
      else emitProgress(progressText(stream, options))
    }

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (progressTimer) clearTimeout(progressTimer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      if (settleTimer) clearTimeout(settleTimer)
      options.signal?.removeEventListener('abort', onAbort)
      fn()
    }

    /** Bounded diagnostics: final/partial assistant text, tool evidence, stderr, raw event tail. */
    const failureDiagnostics = (message: string): string => {
      const evidence = stream.evidence.trim()
      const answer = stream.output.trim() || stream.partialOutput.trim()
      const diagnostics = [
        answer,
        evidence ? `Completed tool evidence:${evidence}` : '',
        stderr.trim(),
        !answer && !evidence ? rawEventTail.trim() : '',
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(-options.maxOutputChars)
      const session = stream.sessionId ? `\nChild session: ${stream.sessionId}` : ''
      return diagnostics
        ? `${message}${session}\n\nPartial child output:\n${diagnostics}`
        : `${message}${session}`
    }

    /**
     * Terminates the process group and defers the rejection until the child has
     * settled (close event, force-kill, or the extra settle delay), so the
     * caller never observes a completed failure while the child may still run.
     */
    const terminate = (message: string): void => {
      if (settled || pendingFailure) return
      pendingFailure = () => new Error(failureDiagnostics(message))
      killProcessGroup('SIGTERM')
      forceKillTimer = setTimeout(() => killProcessGroup('SIGKILL'), FORCE_KILL_DELAY_MS)
      settleTimer = setTimeout(() => {
        const failure = pendingFailure
        if (failure) finish(() => reject(failure()))
      }, FORCE_KILL_DELAY_MS + SETTLE_DELAY_MS)
    }

    const timer = setTimeout(
      () => terminate(`shub-agent timed out after ${options.timeoutMs}ms.`),
      options.timeoutMs,
    )
    const onAbort = (): void => terminate('shub-agent cancelled.')
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      rawEventTail = (rawEventTail + text).slice(-MAX_RAW_EVENT_TAIL_CHARS)
      lineBuffer += text
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? ''
      for (const line of lines) processLine(line)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_RAW_EVENT_TAIL_CHARS)
    })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) => {
      closed = true
      if (lineBuffer.trim()) processLine(lineBuffer)
      finish(() => {
        if (pendingFailure) return reject(pendingFailure())
        resolvePromise({
          code,
          text: stream.output,
          stderr,
          providerError: code !== null && code !== 0 && !stream.output.trim(),
          sessionId: stream.sessionId,
          turnCount: stream.turnCount,
          toolCount: stream.toolCount,
          totalTokens: stream.totalTokens,
          contextTokens: stream.contextTokens,
          costUsd: stream.costUsd,
          elapsedMs: Date.now() - startedAt,
        })
      })
    })
    // The parent may have aborted between the pre-spawn check and listener setup.
    if (options.signal?.aborted) onAbort()
  })
}

/** One line describing the current state, shown live in the parent's tool card. */
export function progressText(
  stream: ShubStream,
  options: Pick<ShubChildOptions, 'agentName' | 'effort' | 'softToolCalls' | 'hardToolCalls'>,
): string {
  const agent = options.agentName ? `${options.agentName} ` : ''
  const budget = `${stream.toolCount}/${options.softToolCalls} target, ${options.hardToolCalls} max`
  if (stream.toolCount === 0) return `${agent}[${options.effort}]: turn ${stream.turnCount}...`
  const notice = stream.toolCount === options.softToolCalls ? ' Target reached; synthesizing.' : ''
  return `${agent}[${options.effort}]: ${stream.lastTool ?? 'tool'} (${budget}).${notice}`
}
