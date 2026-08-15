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

export interface GitSnapshot {
  repository: boolean
  root: string | null
  branch: string | null
  /** True when the working directory is a linked worktree, not the repository's main checkout. */
  worktree: boolean
  files: GitFileChange[]
  /** Commits not yet pushed to this branch's upstream. */
  ahead: number
  /** Main-workspace branch used as the comparison base for linked worktrees. */
  baseBranch: string | null
  /** Commits on this worktree branch that are not on the base branch. */
  baseAhead: number
  /** Commits on the base branch that are not on this worktree branch. */
  baseBehind: number
  commits: GitCommit[]
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
}

export interface WorkspaceFile {
  path: string
  content: string
}

export interface TodoSessionLink {
  id: string
  name: string
  sessionPath: string
}

export interface TodoItem {
  id: string
  text: string
  completed: boolean
  session?: TodoSessionLink
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
  forkEntryId?: string
}

export interface SessionSnapshot {
  state: JsonObject | null
  messages: ConversationMessage[]
  models: JsonObject[]
  commands: JsonObject[]
  promptTemplates: PromptTemplate[]
  stats: SessionStats | null
  liveEvents: Array<{ data: JsonObject; sequence: number }>
}

export interface OpenAiQuotaWindow {
  period: '5h' | '7d'
  remainingPercent: number
  resetsAt?: number
}

export interface CopilotQuotaWindow {
  name: string
  used: number
  limit: number
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

export interface QuotaSnapshot {
  openai: QuotaProviderSnapshot<OpenAiQuotaWindow>
  copilot: QuotaProviderSnapshot<CopilotQuotaWindow>
  glm: QuotaProviderSnapshot<GlmQuotaWindow>
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
  openai: QuotaProviderReport<OpenAiQuotaWindow>
  copilot: QuotaProviderReport<CopilotQuotaWindow>
  // Optional so reports from Pi sessions running an older extension (without GLM)
  // still validate instead of dropping the OpenAI/Copilot readings.
  glm?: QuotaProviderReport<GlmQuotaWindow>
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
  /** Character count of the loaded skill definition. */
  contentChars?: number
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
  contextFiles?: SessionEnvironmentContextFile[]
}

export interface SessionEnvironmentSnapshot {
  tools: SessionEnvironmentTool[]
  skills: SessionEnvironmentSkill[]
  contextFiles: SessionEnvironmentContextFile[]
  updatedAt?: number
  refreshing: boolean
  sessionRequired: boolean
}
