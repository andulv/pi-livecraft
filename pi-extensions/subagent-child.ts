/**
 * Runs one subagent child: a bounded, one-shot `pi --mode json --print` process.
 *
 * The child persists a normal Pi session in the workspace session directory, so
 * every run stays inspectable and its cost stays attributable after the tool
 * call is gone. Ownership is unchanged by this file: children are one-shot
 * non-RPC processes, and `server/manager.ts` remains the sole owner of
 * `pi --mode rpc` processes.
 *
 * Argument assembly and event extraction are exported separately from the spawn
 * so both can be tested without starting a process.
 */
import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isObject } from '../shared/is-object.ts'
import { workspaceSessionFolderName } from '../shared/pi-session-paths.ts'

const MAX_RAW_EVENT_TAIL_CHARS = 50_000
const MAX_PARTIAL_EVIDENCE_CHARS = 20_000
const MAX_EVIDENCE_ITEM_CHARS = 2_000
const PROGRESS_THROTTLE_MS = 300
const FORCE_KILL_DELAY_MS = 5_000

export interface SubagentChildOptions {
  piExecutable: string
  /** Extension entry files loaded into the child; the child is otherwise extension-free. */
  extensions: string[]
  /** Allowlist passed to `--tools`; the only capability boundary the child has. */
  tools: string[]
  cwd: string
  task: string
  /** Absolute image paths passed as `@path` so a vision model reads them. */
  images: string[]
  /** Session display name, which is also how a subagent run is recognized later. */
  sessionName: string
  systemPrompt: string
  model: string
  thinking: string
  effort: string
  softToolCalls: number
  hardToolCalls: number
  timeoutMs: number
  maxOutputChars: number
  signal?: AbortSignal
  onProgress?: (progress: SubagentProgress) => void
}

/** Live state of a running child, reported to the parent tool card. */
export interface SubagentProgress {
  text: string
  sessionId?: string
  turnCount: number
  toolCount: number
  completedToolCount: number
  lastTool?: string
  totalTokens: number
  costUsd: number
  elapsedMs: number
}

export interface SubagentChildResult {
  code: number | null
  text: string
  stderr: string
  sessionId?: string
  turnCount: number
  toolCount: number
  totalTokens: number
  costUsd: number
  elapsedMs: number
}

/**
 * Builds the child command line. `--no-extensions` is both the capability guard
 * and the recursion guard: without it the child would load the user's global
 * extension list, including this one. `--no-session` is deliberately absent so
 * the run persists (see `docs/SUBAGENT-SPEC.md`, D2).
 */
export function subagentChildArguments(
  options: Pick<
    SubagentChildOptions,
    | 'extensions'
    | 'tools'
    | 'task'
    | 'images'
    | 'sessionName'
    | 'systemPrompt'
    | 'model'
    | 'thinking'
  >,
): string[] {
  const args = [
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--mode',
    'json',
    '--name',
    options.sessionName,
  ]
  for (const extension of options.extensions) args.push('--extension', extension)
  args.push('--fff-mode', 'tools-only')
  args.push('--tools', options.tools.join(','))
  args.push('--system-prompt', options.systemPrompt)
  if (options.model) args.push('--model', options.model)
  args.push('--thinking', options.thinking)
  args.push('--print', ...options.images.map((image) => `@${image}`), options.task)
  return args
}

/** Accumulated state of one child, updated from its JSON event stream. */
export interface SubagentStream {
  sessionId?: string
  turnCount: number
  toolCount: number
  completedToolCount: number
  lastTool?: string
  totalTokens: number
  costUsd: number
  /** Assistant text, which is the answer the parent receives. */
  output: string
  /** Tail of completed tool results, used as partial evidence after a timeout. */
  evidence: string
}

export function createSubagentStream(): SubagentStream {
  return {
    turnCount: 0,
    toolCount: 0,
    completedToolCount: 0,
    totalTokens: 0,
    costUsd: 0,
    output: '',
    evidence: '',
  }
}

/**
 * Applies one JSON event line to the stream state and reports what changed, so
 * the caller decides whether the change is worth a progress update.
 */
export function applySubagentEvent(
  stream: SubagentStream,
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
  if (event.type === 'message_update') {
    applyUsage(stream, event.usage)
    return undefined
  }
  if (
    event.type === 'message_end' && isObject(event.message) && event.message.role === 'assistant'
  ) {
    applyUsage(stream, event.message.usage)
    const text = contentText(event.message).trim()
    if (text) stream.output = stream.output ? `${stream.output}\n\n${text}` : text
    return 'answer'
  }
  return undefined
}

/**
 * Usage is cumulative per message, so the latest report for the current message
 * replaces nothing: totals are summed at `message_end` only, and interim
 * `message_update` values keep the live counter roughly current.
 */
function applyUsage(stream: SubagentStream, usage: unknown): void {
  if (!isObject(usage)) return
  if (typeof usage.totalTokens === 'number') stream.totalTokens = usage.totalTokens
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
export async function findSubagentSessionPath(
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
 * turn kills the process group immediately and rejects with whatever evidence
 * the child had already produced; the persisted session keeps the rest.
 */
export function runSubagentChild(options: SubagentChildOptions): Promise<SubagentChildResult> {
  const args = subagentChildArguments(options)
  const startedAt = Date.now()

  return new Promise<SubagentChildResult>((resolvePromise, reject) => {
    const child = spawn(options.piExecutable, args, {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PI_SKIP_VERSION_CHECK: '1',
        PI_FFF_MODE: 'tools-only',
        PI_FFF_MULTIGREP: '0',
        PI_SUBAGENT_SOFT_TOOL_CALLS: String(options.softToolCalls),
        PI_SUBAGENT_HARD_TOOL_CALLS: String(options.hardToolCalls),
      },
    })

    const stream = createSubagentStream()
    let rawEventTail = ''
    let stderr = ''
    let lineBuffer = ''
    let settled = false
    let closed = false
    let lastProgressAt = 0
    let pendingProgress: string | undefined
    let progressTimer: ReturnType<typeof setTimeout> | undefined
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined

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
        costUsd: stream.costUsd,
        elapsedMs: Date.now() - startedAt,
      })
    }

    const emitProgress = (text: string, immediate = false): void => {
      if (!options.onProgress) return
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
      const change = applySubagentEvent(stream, line)
      if (!change) return
      if (change === 'session') emitProgress(progressText(stream, options), true)
      else if (change === 'answer') emitProgress(progressText(stream, options), true)
      else emitProgress(progressText(stream, options))
    }

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (progressTimer) clearTimeout(progressTimer)
      options.signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const terminate = (message: string): void => {
      if (settled) return
      killProcessGroup('SIGTERM')
      forceKillTimer = setTimeout(() => killProcessGroup('SIGKILL'), FORCE_KILL_DELAY_MS)

      const evidence = stream.evidence.trim()
      const diagnostics = [
        stream.output.trim(),
        evidence ? `Completed tool evidence:${evidence}` : '',
        stderr.trim(),
        !stream.output.trim() && !evidence ? rawEventTail.trim() : '',
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(-options.maxOutputChars)
      const session = stream.sessionId ? `\nChild session: ${stream.sessionId}` : ''
      finish(() =>
        reject(
          new Error(
            diagnostics
              ? `${message}${session}\n\nPartial child output:\n${diagnostics}`
              : `${message}${session}`,
          ),
        )
      )
    }

    const timer = setTimeout(
      () => terminate(`Subagent timed out after ${options.timeoutMs}ms.`),
      options.timeoutMs,
    )
    const onAbort = (): void => terminate('Subagent cancelled.')
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
      stderr += chunk.toString()
    })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) => {
      closed = true
      if (lineBuffer.trim()) processLine(lineBuffer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      finish(() =>
        resolvePromise({
          code,
          text: stream.output || rawEventTail,
          stderr,
          sessionId: stream.sessionId,
          turnCount: stream.turnCount,
          toolCount: stream.toolCount,
          totalTokens: stream.totalTokens,
          costUsd: stream.costUsd,
          elapsedMs: Date.now() - startedAt,
        })
      )
    })
  })
}

/** One line describing the current state, shown live in the parent's tool card. */
export function progressText(
  stream: SubagentStream,
  options: Pick<SubagentChildOptions, 'effort' | 'softToolCalls' | 'hardToolCalls'>,
): string {
  const budget = `${stream.toolCount}/${options.softToolCalls} target, ${options.hardToolCalls} max`
  if (stream.toolCount === 0) return `Researching [${options.effort}]: turn ${stream.turnCount}...`
  const notice = stream.toolCount === options.softToolCalls ? ' Target reached; synthesizing.' : ''
  return `Researching [${options.effort}]: ${stream.lastTool ?? 'tool'} (${budget}).${notice}`
}
