export type JsonObject = Record<string, unknown>

export interface SessionSummary {
  id: string
  cwd: string
  name: string
  sessionPath?: string
  activeAgent?: string
  status: 'starting' | 'idle' | 'running' | 'exited'
  pendingUi: JsonObject[]
}

export interface RecentSession {
  id: string
  cwd: string
  name: string
  sessionPath: string
  /** Agent name from the durable ownership marker of a shub-agent child run. */
  shubAgent?: string
  /** Owner session id from the marker of a shub-agent child run. */
  ownerSessionId?: string
  /** Tokens the child's LLM calls processed, measured from its session file. */
  shubTotalTokens?: number
  /** Input context size on the child's last message, measured likewise. */
  shubContextTokens?: number
  /** Characters of final report text the child delivered, measured likewise. */
  shubOutputChars?: number
  /** Timestamp of the session's first message; falls back to the header timestamp. */
  firstMessageAt?: number
  updatedAt: number
}

export interface DirectoryEntry {
  name: string
  path: string
}

export interface DirectoryListing {
  path: string
  parentPath: string | null
  directories: DirectoryEntry[]
}

export interface GitWorkspace {
  path: string
  branch: string | null
  main: boolean
}

export interface GitProject {
  root: string
  workspaces: GitWorkspace[]
}

export interface GitFileChange {
  path: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  additions: number | null
  deletions: number | null
}

export interface GitCommit {
  hash: string
  subject: string
  files: GitFileChange[]
}

/** A recent commit summary shown without its changed-file details. */
export interface GitHistoryCommit {
  hash: string
  subject: string
}

export interface GitSnapshot {
  repository: boolean
  root: string | null
  branch: string | null
  /** True when the working directory is a linked worktree, not the repository's main checkout. */
  worktree: boolean
  files: GitFileChange[]
  /** Commits not yet pushed to this branch's upstream. */
  ahead: number
  /** Commits in the local tracked remote ref but not present locally; null when unavailable. */
  behind: number | null
  /** Main-workspace branch used as the comparison base for linked worktrees. */
  baseBranch: string | null
  /** Commits on this worktree branch that are not on the base branch. */
  baseAhead: number
  /** Commits on the base branch that are not on this worktree branch. */
  baseBehind: number
  /** Commits not yet pushed to the tracked remote branch. */
  commits: GitCommit[]
  /** The 20 most recent commits reachable from HEAD. */
  history: GitHistoryCommit[]
}

export interface GitActionResult {
  committed: boolean
  pushed: boolean
  pushError?: string
}

export interface GitPushResult {
  pushed: boolean
  pushError?: string
}

export interface GitResetResult {
  hash: string
}

export interface GitRevertResult {
  hash: string
}

export interface GitFileDiff {
  path: string
  diff: string
  /** File content before the diff. */
  before: string
  beforeAvailable: boolean
  /** File content after the diff. */
  after: string
  afterAvailable: boolean
}

export interface WorkspaceFile {
  path: string
  content: string
}

export interface WorkspaceFileEntry {
  kind: 'directory' | 'file'
  name: string
  path: string
}

export interface WorkspaceFileListing {
  entries: WorkspaceFileEntry[]
  path: string
}

export interface ManagerRuntimeIdentity {
  instanceId: string
  startedAt: string
  runtimeRevision: string | null
  supervised: boolean
}

export type ManagerRuntimeState =
  | 'checking'
  | 'current'
  | 'stale'
  | 'restarting'
  | 'disconnected'
  | 'unknown'

export interface ManagerRuntimeStatus {
  state: ManagerRuntimeState
  canRestart: boolean
  error?: string
}

export interface ManagerRequest {
  id: string
  action:
    | 'list'
    | 'create'
    | 'open'
    | 'close'
    | 'rename'
    | 'command'
    | 'improve_prompt'
    | 'run_prompt'
    | 'status'
    | 'restart'
  sessionId?: string
  cwd?: string
  name?: string
  sessionPath?: string
  command?: JsonObject
  prompt?: string
  systemPrompt?: string
  thinkingLevel?: string
  model?: { provider: string; modelId: string }
  extensions?: string[]
  tools?: string[]
  includeContextFiles?: boolean
  direction?: string
}

export interface ManagerResponse {
  kind: 'response'
  id: string
  ok: boolean
  data?: unknown
  error?: string
}

export interface ManagerEvent {
  kind: 'event'
  event:
    | 'session_created'
    | 'session_exited'
    | 'session_reassigned'
    | 'manager_connected'
    | 'manager_disconnected'
    | 'manager_status'
    | 'pi'
  sessionId: string
  data?: unknown
  sequence?: number
}

export type ManagerMessage = ManagerResponse | ManagerEvent

export interface SessionStats {
  cost?: number
  userMessages?: number
  assistantMessages?: number
  toolCalls?: number
  toolResults?: number
  totalMessages?: number
  tokens?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
  contextUsage?: {
    tokens?: number | null
    contextWindow?: number | null
    percent?: number | null
  }
}

export interface PromptTemplate {
  name: string
  content: string
  description?: string
}

export interface ConversationMessage extends JsonObject {
  /** Snapshot entry this message was built from; absent only for legacy or id-less entries. */
  entryId?: string
  forkEntryId?: string
  /** Reasoning effort in effect when Pi generated an assistant response, stamped from
   * thinking_level_change entries during snapshot assembly; undefined when never switched. */
  thinkingLevel?: string
}

/** Responses-API answer-length override for models that support it. */
export type ResponseVerbosity = 'low' | 'medium' | 'high'

/** Responses-API reasoning-summary override for models that support it. */
export type ResponseSummary = 'auto' | 'concise' | 'detailed' | 'none'

/** Per-session response-control overrides persisted by the Pi extension. */
export interface ResponseControlsState {
  verbosity?: ResponseVerbosity
  summary?: ResponseSummary
}

/** Composer-facing response controls: capability plus current overrides. */
export interface ResponseControlsReport {
  supported: boolean
  verbosity?: ResponseVerbosity
  summary?: ResponseSummary
}

export interface SessionSnapshot {
  state: JsonObject | null
  messages: ConversationMessage[]
  models: JsonObject[]
  thinkingLevels: string[]
  responseControls: ResponseControlsReport | null
  commands: JsonObject[]
  promptTemplates: PromptTemplate[]
  stats: SessionStats | null
  liveEvents: Array<{ data: JsonObject; sequence: number }>
  /** Names the returned history for incremental fetches: `<count>:<last entryId>`. */
  cursor?: string
}

/** Delta snapshot for a client whose history prefix is still the active chain head. */
export interface SessionSnapshotDelta extends Omit<SessionSnapshot, 'messages'> {
  mode: 'delta'
  appended: ConversationMessage[]
  cursor: string
}

export type SessionSnapshotResponse = SessionSnapshot | SessionSnapshotDelta

/** One content-free diagnostics event; routes are templates without identifiers. */
export interface DiagnosticEventEntry {
  sequence: number
  t: number
  kind: 'request' | 'error' | 'sse-open' | 'snapshot'
  route?: string
  durationMs?: number
  bytes?: number
  mode?: 'full' | 'delta'
  ok: boolean
}

/** Stage timings for one finished snapshot response. */
export interface SnapshotStageEntry {
  sequence: number
  t: number
  rpcMs: number
  buildMs: number
  templatesMs: number
  totalMs: number
  bytes: number
  mode: 'full' | 'delta'
}

/** Bounded backend diagnostics served by `GET /api/diagnostics`. */
/** Sources of client-reported entries in the persistent app log. */
export type ClientLogSource =
  | 'window-error'
  | 'unhandled-rejection'
  | 'fetch-failure'
  | 'sse-drop'
  | 'sse-reopen'

export interface ClientLogRequestBody {
  source: ClientLogSource
  message: string
}

export interface DiagnosticsSnapshot {
  uptimeMs: number
  requests: Record<string, number>
  errors: number
  sseOpens: number
  snapshots: { full: number; delta: number; fullBytes: number; deltaBytes: number }
  cache: { hits: number; misses: number }
  recentEvents: DiagnosticEventEntry[]
  recentStages: SnapshotStageEntry[]
}

export interface OpenAiQuotaWindow {
  period: '5h' | '7d'
  remainingPercent: number
  resetsAt?: number
}

/** Banked Codex rate-limit resets that can still be redeemed. */
export interface OpenAiQuotaResets {
  availableCount: number
  /** Expiry of the soonest-expiring available reset, in ms since epoch. */
  nearestExpiry?: number
}

/**
 * Z.AI reset cards per quota window, from the ZCode account service. Cards are
 * only issued to accounts signed in to ZCode, so the fields are absent otherwise.
 */
export interface GlmQuotaResets {
  fiveHour: { availableCount: number; nearestExpiry?: number }
  week: { availableCount: number; nearestExpiry?: number }
}

export interface CopilotQuotaWindow {
  name: string
  used: number
  limit: number
  resetsAt?: number
}

/** One subscription usage window returned by Anthropic's OAuth usage service. */
export interface AnthropicQuotaWindow {
  kind: 'five-hour' | 'weekly' | 'weekly-model'
  label: string
  usedPercent: number
  resetsAt?: number
}

/**
 * One Coding Plan quota window from Z.AI (GLM). Session and weekly are percentage-used;
 * web-searches is a used/limit count. Absent fields are omitted, never zero-filled.
 */
export interface GlmQuotaWindow {
  kind: 'session' | 'weekly' | 'web-searches'
  usedPercent?: number
  used?: number
  limit?: number
  resetsAt?: number
}

export interface QuotaProviderSnapshot<T> {
  data: T[]
  updatedAt?: number
  stale: boolean
  error?: string
}

/** The OpenAI report additionally carries banked rate-limit resets. */
export type OpenAiQuotaReport =
  | { ok: true; data: OpenAiQuotaWindow[]; resets?: OpenAiQuotaResets }
  | { ok: false; error: string }

export type OpenAiQuotaSnapshot = QuotaProviderSnapshot<OpenAiQuotaWindow> & {
  resets?: OpenAiQuotaResets
}

/** The GLM report additionally carries Z.AI reset cards when ZCode is signed in. */
export type GlmQuotaReport =
  | { ok: true; data: GlmQuotaWindow[]; resets?: GlmQuotaResets }
  | { ok: false; error: string }

export type GlmQuotaSnapshot = QuotaProviderSnapshot<GlmQuotaWindow> & {
  resets?: GlmQuotaResets
}

export interface QuotaSnapshot {
  openai: OpenAiQuotaSnapshot
  anthropic: QuotaProviderSnapshot<AnthropicQuotaWindow>
  copilot: QuotaProviderSnapshot<CopilotQuotaWindow>
  glm: GlmQuotaSnapshot
  refreshing: boolean
  sessionRequired: boolean
}

export type QuotaProviderReport<T> =
  | { ok: true; data: T[] }
  | { ok: false; error: string }

export interface QuotaReport {
  protocol: 'pi-livecraft.quotas'
  version: 1
  refreshedAt: number
  openai: OpenAiQuotaReport
  copilot: QuotaProviderReport<CopilotQuotaWindow>
  // Optional so reports from Pi sessions running older extensions still validate.
  anthropic?: QuotaProviderReport<AnthropicQuotaWindow>
  glm?: GlmQuotaReport
}

/**
 * One parameter from a tool's top-level JSON schema object, summarized so the
 * payload stays small. Absent fields are omitted, never zero-filled.
 */
export interface SessionEnvironmentToolParam {
  name: string
  type?: string
  required?: boolean
  description?: string
}

export interface SessionEnvironmentSkill {
  /** Pi slash-command name, used when the RPC command listing omits its path. */
  name: string
  /** Absolute SKILL.md path; skill contents never leave Pi. */
  path: string
  /** Whether Pi currently includes skills in the system prompt. */
  active?: boolean
  /** Pi's canonical resource scope. */
  scope?: string
  /** Whether Pi loaded the skill directly or from a package. */
  origin?: string
  /** Package or resource base directory when Pi provides one. */
  baseDir?: string
}

export interface SessionEnvironmentTool {
  name: string
  description?: string
  active: boolean
  /** 'builtin', 'sdk', or 'extension' for dynamically registered tools. */
  source: string
  /** Extension file name for extension-registered tools. */
  sourceName?: string
  /** Extension source path; used to distinguish unrelated `index.ts` entry points. */
  sourcePath?: string
  /** Estimated characters in this tool's name, description, and JSON parameter schema. */
  estimatedContextChars?: number
  params?: SessionEnvironmentToolParam[]
}

/** A context file Pi loaded into the system prompt. Only path and size cross the boundary. */
export interface SessionEnvironmentContextFile {
  path: string
  bytes: number
}

/** Who contributed a section of the system prompt. 'session' marks contributions Pi does not attribute. */
export type SessionEnvironmentPromptSource = 'pi' | 'sdk' | 'extension' | 'project' | 'session'

/**
 * One attributable section of the system prompt: who added it and where it sits
 * inside the assembled text. Parts without offsets were not found verbatim in the
 * text and only carry their measured size.
 */
export interface SessionEnvironmentPromptPart {
  kind: 'base' | 'guidelines' | 'snippets' | 'context' | 'custom' | 'append'
  source: SessionEnvironmentPromptSource
  /** Extension file, package directory, or context-file path when the owner has one. */
  ownerPath?: string
  /** File name of the owning extension or context file. */
  ownerName?: string
  /** Tool names whose snippets or guidelines this section carries. */
  tools?: string[]
  chars: number
  /** Char offsets of this section inside the assembled prompt text. */
  start?: number
  end?: number
}

/**
 * The assembled system prompt with its components. Parts carry char offsets into
 * `text` so the browser can render the exact prompt with owner markers between
 * sections.
 */
export interface SessionEnvironmentSystemPrompt {
  totalChars: number
  /** True when a custom prompt replaces Pi's default prompt. */
  hasCustomPrompt?: boolean
  guidelinesCount?: number
  guidelinesChars?: number
  appendChars?: number
  toolSnippetCount?: number
  toolSnippetChars?: number
  /** The assembled prompt text Pi will send; absent until a command-context refresh. */
  text?: string
  /** Prompt sections with their owner and position inside `text`. */
  parts?: SessionEnvironmentPromptPart[]
}

/**
 * Versioned status payload published by the session-environment extension. Sections are
 * optional because session start reports tools before a command context can read the
 * system-prompt options; the cache keeps the previous value of an absent section.
 */
export interface SessionEnvironmentReport {
  protocol: 'pi-livecraft.environment'
  version: 1
  refreshedAt: number
  tools?: SessionEnvironmentTool[]
  skills?: SessionEnvironmentSkill[]
  systemPrompt?: SessionEnvironmentSystemPrompt
  contextFiles?: SessionEnvironmentContextFile[]
}

export interface SessionEnvironmentSnapshot {
  tools: SessionEnvironmentTool[]
  skills: SessionEnvironmentSkill[]
  systemPrompt?: SessionEnvironmentSystemPrompt
  contextFiles: SessionEnvironmentContextFile[]
  updatedAt?: number
  refreshing: boolean
  sessionRequired: boolean
}

/** Lifecycle of one livecast browser instance owned by the backend. */
export type BrowserSessionState = 'off' | 'starting' | 'live' | 'stopped' | 'crashed'

/** Identifies one browser instance inside one canonical workspace. */
export interface BrowserInstanceTarget {
  workspacePath: string
  browserId: string
}

/** Status payload for one browser instance. */
export interface BrowserSessionStatus {
  state: BrowserSessionState
  /** Current page URL while a session is live. */
  url?: string
  /** CDP HTTP endpoint that agent tooling attaches to while a session is live. */
  endpoint?: string
  error?: string
  /** Emulated viewport; frame captures and input coordinates match it 1:1. */
  viewport?: BrowserViewport
}

export interface BrowserViewport {
  width: number
  height: number
  mobile: boolean
}

/** One Chrome process reported by the browser-level CDP target. */
export interface BrowserProcessInfo {
  pid: number
  type: string
  /** Cumulative CPU time reported by Chrome, in seconds. */
  cpuTimeSeconds: number
}

/** Runtime diagnostics for the backend-owned browser session. */
export interface BrowserDebugSnapshot {
  status: BrowserSessionStatus
  sampledAt: number
  rootPid?: number
  startedAt?: number
  viewerCount: number
  capturedFrames: number
  capturedBytes: number
  profilePath?: string
  processes: BrowserProcessInfo[]
  processError?: string
}

/** Diagnostics for one browser instance in a workspace. */
export interface BrowserInstanceDebugSnapshot extends BrowserDebugSnapshot {
  browserId: string
}

/** Browser instances registered for one canonical workspace. */
export interface BrowserWorkspaceDebugSnapshot {
  workspacePath: string
  instances: BrowserInstanceDebugSnapshot[]
}

/** Installation-wide browser diagnostics, grouped by workspace and instance. */
export interface BrowserSystemDebugSnapshot {
  sampledAt: number
  /** Canonical form of the optional workspace requested by the debug client. */
  currentWorkspacePath?: string
  workspaces: BrowserWorkspaceDebugSnapshot[]
}

/** Lifecycle of one embedded terminal session owned by the backend. */
export type TerminalSessionState = 'off' | 'starting' | 'live' | 'exited' | 'crashed'

/** Identifies one terminal session inside one canonical workspace. */
export interface TerminalInstanceTarget {
  workspacePath: string
  terminalId: string
}

/** Status payload for one embedded terminal session. */
export interface TerminalSessionStatus {
  state: TerminalSessionState
  cols?: number
  rows?: number
  shell?: string
  error?: string
}

export type BrowserMouseButton = 'none' | 'left' | 'middle' | 'right' | 'back' | 'forward'

/** Input events forwarded from the livecast pane into one browser instance. */
export type BrowserInputEvent =
  | {
    type: 'mouseMoved' | 'mousePressed' | 'mouseReleased'
    x: number
    y: number
    button: BrowserMouseButton
    clickCount: number
    modifiers: number
  }
  | {
    type: 'mouseWheel'
    x: number
    y: number
    deltaX: number
    deltaY: number
    modifiers: number
  }
  | {
    type: 'keyDown' | 'keyUp'
    key: string
    code: string
    keyCode: number
    modifiers: number
    /** Character produced by the key press; absent for non-text keys. */
    text?: string
  }
  | { type: 'insertText'; text: string }
