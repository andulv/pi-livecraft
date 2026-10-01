import type {
  ExtensionSettingsSnapshot,
  ExtensionSettingValue,
} from '../shared/extension-settings.ts'
import type { PiSettingsScope, PiSettingsSnapshot, PiSettingValue } from '../shared/pi-settings.ts'
import type {
  BrowserInputEvent,
  BrowserInstanceTarget,
  ClientLogRequestBody,
  ClientLogSource,
  BrowserSessionStatus,
  BrowserSystemDebugSnapshot,
  BrowserViewport,
  DirectoryListing,
  GitCommitFiles,
  GitFileDiff,
  GitOutgoingChanges,
  GitProject,
  GitPushResult,
  GitResetResult,
  GitRevertResult,
  GitSnapshot,
  JsonObject,
  ManagerEvent,
  PromptTemplate,
  QuotaSnapshot,
  RecentSession,
  DiagnosticsSnapshot,
  SessionEnvironmentSnapshot,
  SessionSnapshot,
  SessionSnapshotDelta,
  SessionSummary,
  TerminalInstanceTarget,
  TerminalSessionStatus,
  WorkspaceFile,
  WorkspaceFileListing,
} from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'
import { requestCauseHeader } from '../shared/types.ts'

/**
 * Names the trigger of a backend request whose work is expensive (Git processes, session
 * scans), as `<area>:<trigger>` — for example `git:tool-end`. The backend attributes every
 * operation the request performs to it in diagnostics; see the diagnostics README.
 */
export type RequestCause = `${string}:${string}`

function causeHeaders(cause: RequestCause): Record<string, string> {
  return { [requestCauseHeader]: cause }
}

const viewId = crypto.randomUUID().slice(0, 8)
let lastManagerMessageAt: number | undefined
let managerStream: EventSource | undefined

/** This tab's long-lived streams; closed ones are pruned when the load is reported. */
const trackedStreams = new Map<EventSource, 'events' | 'frames' | 'terminal'>()
/** Start times of requests still awaiting a response, keyed by an opaque token. */
const pendingRequests = new Map<object, number>()
/** A GET still pending after this long is reported once as `fetch-stall`. */
const fetchStallMs = 15_000

function trackStream(kind: 'events' | 'frames' | 'terminal', source: EventSource): EventSource {
  trackedStreams.set(source, kind)
  return source
}

/**
 * Summarizes this tab's open streams (events/frames/terminal) and pending requests for drop
 * and stall reports. Every stream holds one HTTP/1.1 connection, and Chrome shares six per
 * origin across all tabs, so this shows whether requests could be queued behind them.
 */
export function connectionLoad(): string {
  const counts = { events: 0, frames: 0, terminal: 0 }
  for (const [source, kind] of trackedStreams) {
    if (source.readyState === EventSource.CLOSED) trackedStreams.delete(source)
    else counts[kind] += 1
  }
  const now = Date.now()
  let oldestPendingMs = 0
  for (const startedAt of pendingRequests.values()) {
    oldestPendingMs = Math.max(oldestPendingMs, now - startedAt)
  }
  return `streams=e${counts.events}/f${counts.frames}/t${counts.terminal}; pending=${pendingRequests.size}; oldestPendingMs=${oldestPendingMs}`
}

/** Content-free route for client reports: no query, session or instance identifiers. */
function requestRouteTemplate(path: string): string {
  return (path.split('?')[0] ?? '')
    .replace(/^\/api\//, '')
    .replace(/sessions\/[^/]+(?=\/)/, 'sessions/:id')
    .replace(/instances\/[^/]+/, 'instances/:id')
}

/** The browser's manager EventSource state, not the backend-to-manager connection state. */
export function managerEventStreamState(): 'connecting' | 'open' | 'closed' | 'none' {
  if (!managerStream) return 'none'
  if (managerStream.readyState === 0) return 'connecting'
  if (managerStream.readyState === 1) return 'open'
  return 'closed'
}

/** Time since this page received a validated manager SSE frame; idle streams can be silent. */
export function managerStreamSilenceMs(): number | undefined {
  return lastManagerMessageAt === undefined
    ? undefined
    : Math.max(0, Date.now() - lastManagerMessageAt)
}

const managerEventNames: readonly ManagerEvent['event'][] = [
  'session_created',
  'session_exited',
  'session_reassigned',
  'manager_connected',
  'manager_disconnected',
  'manager_status',
  'pi',
]

/** Parses and validates an event received from the backend SSE boundary. */
export function parseManagerEvent(data: string): ManagerEvent | null {
  try {
    const value: unknown = JSON.parse(data)
    if (
      !isObject(value) || value.kind !== 'event' || typeof value.event !== 'string'
      || typeof value.sessionId !== 'string'
    ) return null
    if (!managerEventNames.includes(value.event as ManagerEvent['event'])) return null
    if (
      value.sequence !== undefined
      && (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0)
    ) return null
    return value as unknown as ManagerEvent
  } catch {
    return null
  }
}

/**
 * Subscribes to validated manager events, using native retries for CONNECTING and a
 * bounded explicit reopen for CLOSED streams that cannot recover on their own.
 * Opening proves the backend transport recovered; its first event still reports whether the
 * manager itself is connected or disconnected.
 */
export function subscribeManagerEvents(
  onEvent: (event: ManagerEvent) => void,
  onError: () => void,
  onOpen?: () => void,
  isHidden?: () => boolean,
): () => void {
  let source: EventSource | undefined
  let droppedAt: number | undefined
  let reopenTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelayMs = 500
  let disposed = false
  lastManagerMessageAt = undefined

  const open = (): void => {
    if (disposed) return
    const stream = trackStream('events', new EventSource('/api/events'))
    source = stream
    managerStream = stream
    stream.onmessage = ({ data }) => {
      const event = parseManagerEvent(data)
      if (event) {
        lastManagerMessageAt = Date.now()
        onEvent(event)
      }
    }
    stream.onopen = () => {
      retryDelayMs = 500
      onOpen?.()
      if (droppedAt === undefined) return
      const durationMs = Math.max(0, Date.now() - droppedAt)
      droppedAt = undefined
      void postClientLog(
        'sse-reopen',
        `manager event stream recovered after ${durationMs} ms; silenceMs=${
          managerStreamSilenceMs() ?? 'none'
        }; hidden=${
          isHidden?.() ?? 'unknown'
        }; state=${managerEventStreamState()}; ${connectionLoad()}`,
      )
    }
    stream.onerror = () => {
      if (droppedAt === undefined) {
        droppedAt = Date.now()
        void postClientLog(
          'sse-drop',
          `manager event stream error; silenceMs=${managerStreamSilenceMs() ?? 'none'}; hidden=${
            isHidden?.() ?? 'unknown'
          }; state=${managerEventStreamState()}; ${connectionLoad()}`,
        )
        onError()
      }
      // CONNECTING retries natively. CLOSED cannot recover without a new EventSource.
      if (stream.readyState !== EventSource.CLOSED || disposed || reopenTimer !== undefined)
        return
      stream.close()
      reopenTimer = setTimeout(() => {
        reopenTimer = undefined
        open()
      }, retryDelayMs)
      retryDelayMs = Math.min(retryDelayMs * 2, 30_000)
    }
  }
  open()
  return () => {
    disposed = true
    if (reopenTimer !== undefined) clearTimeout(reopenTimer)
    source?.close()
    if (managerStream === source) managerStream = undefined
  }
}

export async function listSessions(cause: RequestCause): Promise<SessionSummary[]> {
  return request<SessionSummary[]>('/api/sessions', { headers: causeHeaders(cause) })
}

export async function restartManager(): Promise<void> {
  await request<void>('/api/manager/restart', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function listRecentSessions(
  cwd: string,
  cause: RequestCause,
): Promise<RecentSession[]> {
  return request<RecentSession[]>(`/api/sessions/recent?cwd=${encodeURIComponent(cwd)}`, {
    headers: causeHeaders(cause),
  })
}

/** Refreshes known (pinned) sessions by their stored file paths without a directory scan. */
export async function resolveSessions(
  paths: readonly string[],
  cause: RequestCause,
): Promise<RecentSession[]> {
  return request<RecentSession[]>('/api/sessions/resolve', {
    method: 'POST',
    headers: causeHeaders(cause),
    body: JSON.stringify({ paths }),
  })
}

export async function listDirectories(path: string): Promise<DirectoryListing> {
  return request<DirectoryListing>(`/api/directories?path=${encodeURIComponent(path)}`)
}

export async function openExplorer(cwd: string): Promise<void> {
  await request<void>('/api/explorer', {
    method: 'POST',
    body: JSON.stringify({ cwd }),
  })
}

export async function getGitSnapshot(cwd: string, cause: RequestCause): Promise<GitSnapshot> {
  return request<GitSnapshot>(`/api/git?cwd=${encodeURIComponent(cwd)}`, {
    headers: causeHeaders(cause),
  })
}

/** Resolves a Git repository to its main checkout and every linked worktree. */
export async function getGitProject(cwd: string, cause: RequestCause): Promise<GitProject> {
  return request<GitProject>(`/api/git/project?cwd=${encodeURIComponent(cwd)}`, {
    headers: causeHeaders(cause),
  })
}

export async function getGitCommitFiles(cwd: string, hash: string): Promise<GitCommitFiles> {
  return request<GitCommitFiles>(
    `/api/git/commit-files?cwd=${encodeURIComponent(cwd)}&hash=${encodeURIComponent(hash)}`,
  )
}

export async function getGitOutgoingChanges(cwd: string): Promise<GitOutgoingChanges> {
  return request<GitOutgoingChanges>(`/api/git/outgoing?cwd=${encodeURIComponent(cwd)}`)
}

export async function getGitOutgoingFileDiff(cwd: string, path: string): Promise<GitFileDiff> {
  return request<GitFileDiff>(
    `/api/git/outgoing/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
  )
}

export async function getGitFileDiff(
  cwd: string,
  path: string,
  commitHash?: string,
): Promise<GitFileDiff> {
  const commit = commitHash ? `&commit=${encodeURIComponent(commitHash)}` : ''
  return request<GitFileDiff>(
    `/api/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}${commit}`,
  )
}

export async function listWorkspaceFiles(
  cwd: string,
  path: string,
): Promise<WorkspaceFileListing> {
  return request<WorkspaceFileListing>(
    `/api/files/list?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
  )
}

export async function getWorkspaceFile(cwd: string, path: string): Promise<WorkspaceFile> {
  return request<WorkspaceFile>(
    `/api/files?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
  )
}

export async function openWorkspaceFile(cwd: string, path: string): Promise<void> {
  await request<void>('/api/files/open', {
    method: 'POST',
    body: JSON.stringify({ cwd, path }),
  })
}

export async function getWorkspaceFilePath(
  cwd: string,
  path: string,
): Promise<{ absolutePath: string; path: string }> {
  return request<{ absolutePath: string; path: string }>(
    `/api/files/path?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
  )
}

export async function openVSCode(
  cwd: string,
  projectName: string,
  workspaceName: string,
  color: string,
  isMainWorktree: boolean,
): Promise<void> {
  await request<void>('/api/vscode', {
    method: 'POST',
    body: JSON.stringify({ cwd, projectName, workspaceName, color, isMainWorktree }),
  })
}

/** Reads the branded title bar color for a workspace, if its VS Code settings define one. */
export async function getVSCodeTitleBarColor(cwd: string): Promise<string | null> {
  const result = await request<{ color: string | null }>(
    `/api/vscode/titlebar-color?cwd=${encodeURIComponent(cwd)}`,
  )
  return result.color
}

export async function openTerminal(cwd: string, template: string): Promise<void> {
  await request<void>('/api/terminal', {
    method: 'POST',
    body: JSON.stringify({ cwd, template }),
  })
}

export async function commitChanges(cwd: string, message: string): Promise<void> {
  await request<void>('/api/git/commit', {
    method: 'POST',
    body: JSON.stringify({ cwd, message }),
  })
}

export async function pullCommits(cwd: string): Promise<void> {
  await request<void>('/api/git/pull', {
    method: 'POST',
    body: JSON.stringify({ cwd }),
  })
}

export async function pushCommits(cwd: string): Promise<GitPushResult> {
  return request<GitPushResult>('/api/git/push', {
    method: 'POST',
    body: JSON.stringify({ cwd }),
  })
}

export async function discardChanges(cwd: string, path?: string): Promise<void> {
  await request<void>('/api/git/discard', {
    method: 'POST',
    body: JSON.stringify({ cwd, path }),
  })
}

export async function resetGitCommit(cwd: string, hash: string): Promise<GitResetResult> {
  return request<GitResetResult>('/api/git/reset', {
    method: 'POST',
    body: JSON.stringify({ cwd, hash }),
  })
}

export async function revertGitCommit(cwd: string, hash: string): Promise<GitRevertResult> {
  return request<GitRevertResult>('/api/git/revert', {
    method: 'POST',
    body: JSON.stringify({ cwd, hash }),
  })
}

/** Persists a draft using Pi's project or user prompt-template convention. */
export async function savePrompt(
  cwd: string,
  scope: 'global' | 'project',
  name: string,
  content: string,
): Promise<PromptTemplate> {
  return request<PromptTemplate>('/api/prompts', {
    method: 'POST',
    body: JSON.stringify({ cwd, scope, name, content }),
  })
}

export async function createSession(cwd: string): Promise<SessionSummary> {
  return request<SessionSummary>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ cwd }),
  })
}

export async function openSession(cwd: string, sessionPath: string): Promise<SessionSummary> {
  return request<SessionSummary>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ cwd, sessionPath }),
  })
}

export async function closeSession(sessionId: string): Promise<void> {
  await request<void>(`/api/sessions/${encodeURIComponent(sessionId)}/close`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function renameSession(
  cwd: string,
  sessionPath: string,
  name: string,
): Promise<void> {
  await request<void>('/api/sessions/rename', {
    method: 'POST',
    body: JSON.stringify({ cwd, name, sessionPath }),
  })
}

export type SessionSnapshotResponse = SessionSnapshot | SessionSnapshotDelta

export async function getSnapshot(
  sessionId: string,
  cause: RequestCause,
  since?: string,
): Promise<SessionSnapshotResponse> {
  const query = since ? `?since=${encodeURIComponent(since)}` : ''
  return request<SessionSnapshotResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/snapshot${query}`,
    { headers: causeHeaders(cause) },
  )
}

export async function getQuotas(cause: RequestCause): Promise<QuotaSnapshot> {
  return request<QuotaSnapshot>('/api/quotas', { headers: causeHeaders(cause) })
}

export async function getDiagnostics(): Promise<DiagnosticsSnapshot> {
  return request<DiagnosticsSnapshot>('/api/diagnostics')
}

export async function refreshQuotas(
  sessionId: string,
  automatic: boolean,
  cause: RequestCause,
): Promise<QuotaSnapshot> {
  return request<QuotaSnapshot>('/api/quotas/refresh', {
    method: 'POST',
    headers: causeHeaders(cause),
    body: JSON.stringify({ automatic, sessionId }),
  })
}

export type QuotaResetTarget = 'openai' | 'glm-five-hour' | 'glm-week'

export async function resetQuota(
  sessionId: string,
  target: QuotaResetTarget = 'openai',
): Promise<{ ok: boolean; error?: string }> {
  return request<{ ok: boolean; error?: string }>('/api/quotas/reset', {
    method: 'POST',
    body: JSON.stringify({ sessionId, target }),
  })
}

export async function getEnvironment(
  sessionId: string,
  cause: RequestCause,
): Promise<SessionEnvironmentSnapshot> {
  return request<SessionEnvironmentSnapshot>(
    `/api/environment?sessionId=${encodeURIComponent(sessionId)}`,
    { headers: causeHeaders(cause) },
  )
}

/** Reports settings published by the installed Pi extensions and their stored values. */
export async function getExtensionSettings(): Promise<ExtensionSettingsSnapshot> {
  return request<ExtensionSettingsSnapshot>('/api/extension-settings')
}

/** Stores or clears one published extension setting; `null` restores the extension default. */
export async function updateExtensionSetting(
  extension: string,
  id: string,
  value: ExtensionSettingValue | null,
): Promise<ExtensionSettingsSnapshot> {
  return request<ExtensionSettingsSnapshot>('/api/extension-settings', {
    method: 'POST',
    body: JSON.stringify({ extension, id, value }),
  })
}

/** Reads Pi's global and project settings files with the curated field registry. */
export async function getPiSettings(cwd?: string): Promise<PiSettingsSnapshot> {
  const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return request<PiSettingsSnapshot>(`/api/pi-settings${query}`)
}

/** Stores or clears one curated Pi setting; `null` restores Pi's default. */
export async function updatePiSetting(
  scope: PiSettingsScope,
  cwd: string | undefined,
  id: string,
  value: PiSettingValue | null,
): Promise<PiSettingsSnapshot> {
  return request<PiSettingsSnapshot>('/api/pi-settings', {
    method: 'POST',
    body: JSON.stringify({ scope, cwd, id, value }),
  })
}

/** Saves a whole Pi settings document verbatim, preserving unmodeled keys. */
export async function savePiSettingsDocument(
  scope: PiSettingsScope,
  cwd: string | undefined,
  text: string,
): Promise<PiSettingsSnapshot> {
  return request<PiSettingsSnapshot>('/api/pi-settings/document', {
    method: 'PUT',
    body: JSON.stringify({ scope, cwd, text }),
  })
}

function browserInstanceUrl(target: BrowserInstanceTarget, action?: string): string {
  const base = `/api/browser/instances/${encodeURIComponent(target.browserId)}`
  return action ? `${base}/${action}` : base
}

function browserWorkspaceQuery(target: BrowserInstanceTarget): string {
  return `workspacePath=${encodeURIComponent(target.workspacePath)}`
}

export async function startBrowserSession(
  target: BrowserInstanceTarget,
): Promise<BrowserSessionStatus> {
  return request<BrowserSessionStatus>(browserInstanceUrl(target, 'start'), {
    method: 'POST',
    body: JSON.stringify({ workspacePath: target.workspacePath }),
  })
}

export async function stopBrowserSession(target: BrowserInstanceTarget): Promise<void> {
  await request<void>(browserInstanceUrl(target, 'stop'), {
    method: 'POST',
    body: JSON.stringify({ workspacePath: target.workspacePath }),
  })
}

export async function removeBrowserInstance(target: BrowserInstanceTarget): Promise<void> {
  await request<void>(`${browserInstanceUrl(target)}?${browserWorkspaceQuery(target)}`, {
    method: 'DELETE',
  })
}

export async function getBrowserStatus(
  target: BrowserInstanceTarget,
): Promise<BrowserSessionStatus> {
  return request<BrowserSessionStatus>(
    `${browserInstanceUrl(target, 'status')}?${browserWorkspaceQuery(target)}`,
  )
}

export async function getBrowserDebugSnapshot(
  workspacePath?: string,
): Promise<BrowserSystemDebugSnapshot> {
  const query = workspacePath
    ? `?workspacePath=${encodeURIComponent(workspacePath)}`
    : ''
  return request<BrowserSystemDebugSnapshot>(`/api/browser/debug${query}`)
}

export async function navigateBrowser(target: BrowserInstanceTarget, url: string): Promise<void> {
  await request<void>(browserInstanceUrl(target, 'navigate'), {
    method: 'POST',
    body: JSON.stringify({ workspacePath: target.workspacePath, url }),
  })
}

export async function reloadBrowser(target: BrowserInstanceTarget): Promise<void> {
  await request<void>(browserInstanceUrl(target, 'reload'), {
    method: 'POST',
    body: JSON.stringify({ workspacePath: target.workspacePath }),
  })
}

export async function setBrowserViewport(
  target: BrowserInstanceTarget,
  viewport: BrowserViewport,
): Promise<void> {
  await request<void>(browserInstanceUrl(target, 'viewport'), {
    method: 'POST',
    body: JSON.stringify({ workspacePath: target.workspacePath, ...viewport }),
  })
}

/** Fire-and-forget input forwarding; pane status errors surface via the stream. */
/** Queued input per browser viewer target; see `sendBrowserInput`. */
const browserInputQueues = new Map<string, { sending: boolean; events: BrowserInputEvent[] }>()
/** Bounds the queue while the backend is slow or unreachable; see `sendBrowserInput`. */
const maxQueuedBrowserInput = 200

/**
 * Forwards one input event to the shared browser. At most one input request per target is in
 * flight, so input occupies one HTTP connection and reaches Chrome in order. While a request
 * is pending, a pointer move replaces a queued move directly before it (the latest position
 * wins); presses, releases, wheel, and keys are never merged or reordered. This is a stop-gap
 * until the viewer moves to a WebSocket (plans/proposals/browser-websocket-transport.md).
 */
export function sendBrowserInput(target: BrowserInstanceTarget, event: BrowserInputEvent): void {
  const key = `${target.workspacePath}\0${target.browserId}`
  let queue = browserInputQueues.get(key)
  if (!queue) {
    queue = { sending: false, events: [] }
    browserInputQueues.set(key, queue)
  }
  const last = queue.events.at(-1)
  if (event.type === 'mouseMoved' && last?.type === 'mouseMoved')
    queue.events[queue.events.length - 1] = event
  else queue.events.push(event)
  if (queue.events.length > maxQueuedBrowserInput) {
    // Shed pointer moves first. A backlog of only presses, releases, wheel, and keys means
    // the backend has been unreachable for a long time: discard it rather than replay stale
    // input later, and never drop a single release out of order.
    const moveIndex = queue.events.findIndex(({ type }) => type === 'mouseMoved')
    if (moveIndex >= 0) queue.events.splice(moveIndex, 1)
    else queue.events.length = 0
  }
  if (!queue.sending) void drainBrowserInput(target, key, queue)
}

async function drainBrowserInput(
  target: BrowserInstanceTarget,
  key: string,
  queue: { sending: boolean; events: BrowserInputEvent[] },
): Promise<void> {
  queue.sending = true
  try {
    for (let event = queue.events.shift(); event; event = queue.events.shift()) {
      await request<void>(browserInstanceUrl(target, 'input'), {
        method: 'POST',
        body: JSON.stringify({ workspacePath: target.workspacePath, ...event }),
      })
        .catch(() => {})
    }
  } finally {
    queue.sending = false
    if (browserInputQueues.get(key) === queue && queue.events.length === 0)
      browserInputQueues.delete(key)
  }
}

export async function stopTerminalSession(target: TerminalInstanceTarget): Promise<void> {
  await request<void>(terminalInstanceUrl(target, 'stop'), {
    method: 'POST',
    body: JSON.stringify({ workspacePath: target.workspacePath }),
  })
}

export async function startTerminalSession(
  target: TerminalInstanceTarget,
): Promise<TerminalSessionStatus> {
  return request<TerminalSessionStatus>(terminalInstanceUrl(target, 'start'), {
    method: 'POST',
    body: JSON.stringify({ workspacePath: target.workspacePath }),
  })
}

function terminalInstanceUrl(target: TerminalInstanceTarget, action?: string): string {
  const base = `/api/terminal/instances/${encodeURIComponent(target.terminalId)}`
  return action ? `${base}/${action}` : base
}

/** One-in-flight sender that preserves submission order and coalesces a backlog. */
export interface OrderedSender {
  send(data: string): void
}

/** Creates a sender that keeps one POST in flight and merges bytes queued behind it. */
export function createOrderedSender(post: (data: string) => Promise<unknown>): OrderedSender {
  let queued = ''
  let sending = false
  const pump = (): void => {
    if (sending || queued === '') return
    const batch = queued
    queued = ''
    sending = true
    void post(batch).catch(() => {}).finally(() => {
      sending = false
      pump()
    })
  }
  return {
    send(data) {
      if (!data) return
      queued += data
      pump()
    },
  }
}

const terminalSenders = new Map<string, OrderedSender>()

function terminalSender(target: TerminalInstanceTarget): OrderedSender {
  const key = `${target.workspacePath}\u0000${target.terminalId}`
  let sender = terminalSenders.get(key)
  if (!sender) {
    sender = createOrderedSender((data) =>
      request<void>(terminalInstanceUrl(target, 'input'), {
        method: 'POST',
        body: JSON.stringify({ workspacePath: target.workspacePath, data }),
      })
    )
    terminalSenders.set(key, sender)
  }
  return sender
}

export type BrowserStreamState = 'connecting' | 'connected' | 'stale'

const browserStreamHeartbeatTimeoutMs = 30_000
const browserStreamWatchdogIntervalMs = 1_000

export interface BrowserEventHandlers {
  onFrame?: (data: string) => void
  onUrl?: (url: string) => void
  onStatus?: (status: BrowserSessionStatus) => void
  onStreamState?: (state: BrowserStreamState) => void
}

/** Subscribes to one browser instance's livecast frame, url, and status streams. */
export function subscribeBrowserEvents(
  target: BrowserInstanceTarget,
  handlers: BrowserEventHandlers,
): () => void {
  let disposed = false
  let stale = false
  let lastHeartbeatAt = Date.now()
  let watchdog: ReturnType<typeof setInterval> | undefined
  handlers.onStreamState?.('connecting')
  const source = trackStream(
    'frames',
    new EventSource(`${browserInstanceUrl(target, 'frames')}?${browserWorkspaceQuery(target)}`),
  )
  const markStale = (): void => {
    if (disposed || stale) return
    stale = true
    source.close()
    if (watchdog !== undefined) clearInterval(watchdog)
    handlers.onStreamState?.('stale')
  }
  const onNamedEvent = (name: string, handle: (data: unknown) => void): void => {
    source.addEventListener(name, (event) => {
      if (disposed) return
      const data = (event as { data?: unknown }).data
      if (typeof data !== 'string') return
      try {
        handle(JSON.parse(data))
      } catch {
        // Ignore malformed stream payloads.
      }
    })
  }
  onNamedEvent('frame', (value) => {
    if (isObject(value) && typeof value.data === 'string') handlers.onFrame?.(value.data)
  })
  onNamedEvent('url', (value) => {
    if (isObject(value) && typeof value.url === 'string') handlers.onUrl?.(value.url)
  })
  onNamedEvent('status', (value) => {
    if (isObject(value) && typeof value.state === 'string') {
      handlers.onStatus?.(value as unknown as BrowserSessionStatus)
    }
  })
  onNamedEvent('heartbeat', () => {
    if (stale) return
    lastHeartbeatAt = Date.now()
    handlers.onStreamState?.('connected')
  })
  source.onerror = () => {
    if (disposed) return
    void postClientLog('sse-drop', `browser stream error; ${connectionLoad()}`)
    markStale()
  }
  watchdog = setInterval(() => {
    if (Date.now() - lastHeartbeatAt >= browserStreamHeartbeatTimeoutMs) markStale()
  }, browserStreamWatchdogIntervalMs)
  return () => {
    disposed = true
    source.close()
    if (watchdog !== undefined) clearInterval(watchdog)
  }
}

/** Forwards typed bytes in order; a backlog of keystrokes merges into the next POST. */
export function sendTerminalInput(target: TerminalInstanceTarget, data: string): void {
  terminalSender(target).send(data)
}

/** Fire-and-forget resize; the latest size wins and races with input are harmless. */
export function resizeTerminal(
  target: TerminalInstanceTarget,
  cols: number,
  rows: number,
): void {
  void request<void>(terminalInstanceUrl(target, 'resize'), {
    method: 'POST',
    body: JSON.stringify({ workspacePath: target.workspacePath, cols, rows }),
  })
    .catch(() => {})
}

export interface TerminalStreamHandlers {
  onOutput: (base64: string) => void
  onStatus: (status: TerminalSessionStatus) => void
}

/** Validates a raw SSE data field into the base64 output payload it carries. Pure. */
export function parseTerminalOutputPayload(data: string): string | null {
  try {
    const value: unknown = JSON.parse(data)
    return isObject(value) && typeof value.data === 'string' ? value.data : null
  } catch {
    return null
  }
}

/** Subscribes to one terminal's output stream, resuming from the last seen id on reopen. */
export function subscribeTerminalOutput(
  target: TerminalInstanceTarget,
  handlers: TerminalStreamHandlers,
): () => void {
  let lastSeenId: number | undefined
  let disposed = false
  let reopenTimer: ReturnType<typeof setTimeout> | null = null
  let source: EventSource | null = null
  const open = (): void => {
    if (disposed) return
    // EventSource reconnects on its own carrying the Last-Event-ID header; the
    // query covers a deliberate reopen after the stream reached CLOSED state.
    const query = lastSeenId === undefined
      ? `workspacePath=${encodeURIComponent(target.workspacePath)}`
      : `workspacePath=${encodeURIComponent(target.workspacePath)}&lastEventId=${lastSeenId}`
    source = trackStream(
      'terminal',
      new EventSource(`${terminalInstanceUrl(target, 'stream')}?${query}`),
    )
    source.addEventListener('output', (event) => {
      const rawId = (event as MessageEvent).lastEventId
      const parsed = Number(rawId)
      if (rawId !== '' && Number.isSafeInteger(parsed) && parsed >= 0) lastSeenId = parsed
      const data = (event as { data?: unknown }).data
      if (typeof data !== 'string') return
      const payload = parseTerminalOutputPayload(data)
      if (payload !== null) handlers.onOutput(payload)
    })
    source.addEventListener('status', (event) => {
      const data = (event as { data?: unknown }).data
      if (typeof data !== 'string') return
      try {
        const value: unknown = JSON.parse(data)
        if (isObject(value) && typeof value.state === 'string') {
          handlers.onStatus(value as unknown as TerminalSessionStatus)
        }
      } catch {
        // Ignore malformed stream payloads.
      }
    })
    source.onerror = () => {
      if (source && source.readyState === EventSource.CLOSED) {
        void postClientLog('sse-drop', `terminal stream closed; ${connectionLoad()}`)
        source.close()
        source = null
        reopenTimer = setTimeout(open, 500)
        void postClientLog('sse-reopen', 'terminal stream reopen scheduled')
      }
    }
  }
  open()
  return () => {
    disposed = true
    if (reopenTimer !== null) clearTimeout(reopenTimer)
    source?.close()
    source = null
  }
}

export async function refreshEnvironment(
  sessionId: string,
  cause: RequestCause,
): Promise<SessionEnvironmentSnapshot> {
  return request<SessionEnvironmentSnapshot>('/api/environment/refresh', {
    method: 'POST',
    headers: causeHeaders(cause),
    body: JSON.stringify({ sessionId }),
  })
}

/** Requests an isolated rewrite without adding the draft or result to the active Pi session. */
export async function improvePrompt(
  sessionId: string,
  prompt: string,
  direction?: string,
): Promise<{ prompt: string; cost?: number }> {
  return request<{ prompt: string; cost?: number }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/prompt-improvement`,
    {
      method: 'POST',
      body: JSON.stringify({ prompt, direction }),
    },
  )
}

/** Configuration for an isolated Pi prompt execution. */
export interface RunPromptOptions {
  prompt: string
  systemPrompt?: string
  thinkingLevel?: string
  model?: { provider: string; modelId: string }
  extensions?: string[]
  tools?: string[]
  /** Disable automatic AGENTS.md/CLAUDE.md loading (default true). Set false to provide your own context. */
  includeContextFiles?: boolean
}

/** Runs a prompt in an isolated Pi process with caller-controlled configuration. */
export async function runPrompt(sessionId: string, options: RunPromptOptions): Promise<string> {
  const result = await request<{ text: string }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/run-prompt`,
    {
      method: 'POST',
      body: JSON.stringify(options),
    },
  )
  return result.text
}

export async function sendPiCommand(sessionId: string, command: JsonObject): Promise<JsonObject> {
  return request<JsonObject>(`/api/sessions/${encodeURIComponent(sessionId)}/commands`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
}

const inflightGet = new Map<string, Promise<unknown>>()

async function performRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = {}
  pendingRequests.set(token, Date.now())
  // Only GETs: the routes that are legitimately slow (prompt runs, quota refreshes, push and
  // pull) are POSTs, while a stalled GET is what leaves a view waiting indefinitely.
  const method = init?.method?.toUpperCase() ?? 'GET'
  const stallTimer = method === 'GET'
    ? setTimeout(() => {
      void postClientLog(
        'fetch-stall',
        `route=${requestRouteTemplate(path)}; pendingMs=${fetchStallMs}; ${connectionLoad()}`,
      )
    }, fetchStallMs)
    : undefined
  try {
    let response: Response
    try {
      response = await fetch(path, {
        ...init,
        headers: typeof init?.body === 'string'
          ? { 'Content-Type': 'application/json', ...init.headers }
          : init?.headers,
      })
    } catch (error) {
      // Network failure: the backend is unreachable, so the report itself will be
      // dropped; the throw preserves the caller's error handling.
      void postClientLog(
        'fetch-failure',
        `network error: ${error instanceof Error ? error.message : String(error)}`,
      )
      throw error
    }
    const value: unknown = await response.json()
    if (!response.ok) {
      // Only unexpected server failures are instability; 4xx is user-visible validation.
      if (response.status >= 500) void postClientLog('fetch-failure', `HTTP ${response.status}`)
      const message = isObject(value) && typeof value.error === 'string'
        ? value.error
        : `Request failed (${response.status})`
      throw new Error(message)
    }
    return value as T
  } finally {
    if (stallTimer !== undefined) clearTimeout(stallTimer)
    pendingRequests.delete(token)
  }
}

/** Posts one bounded client entry to the backend app log; failures are silent by design. */
export async function postClientLog(source: ClientLogSource, message: string): Promise<void> {
  try {
    // Raw fetch, not request(): reporting must not recurse through failure reporting.
    await fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        {
          source,
          message: `view=${viewId} ${message}`.slice(0, 500),
        } satisfies ClientLogRequestBody,
      ),
    })
  } catch {
    // An unreachable backend drops the entry; the next successful report covers the gap.
  }
}

/** Fetches a resource, sharing concurrent identical GET requests so duplicated
 *  effect re-runs and overlapping callers issue a single network call. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase()
  if (method && method !== 'GET') return performRequest<T>(path, init)
  const existing = inflightGet.get(path)
  if (existing) return existing as Promise<T>
  const promise = performRequest<T>(path, init).finally(() => inflightGet.delete(path))
  inflightGet.set(path, promise)
  return promise
}
