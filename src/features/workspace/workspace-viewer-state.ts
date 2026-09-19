import { isObject } from '../../../shared/is-object.ts'

/** The viewer pane shows an open file, Git diff, browser, or terminal. */
export type PaneView =
  | { kind: 'file'; path: string }
  | { kind: 'git-diff'; id: string }
  | { kind: 'browser'; browserId: string }
  | { kind: 'terminal'; terminalId: string }

/** A Git diff tab is deliberately runtime-only: diffs can be stale after reload. */
export interface GitDiffTab {
  id: string
  path: string
  commitHash?: string
  diff: string
  before: string
  beforeAvailable: boolean
  after: string
  afterAvailable: boolean
}

export interface WorkspaceViewerState {
  openFilePaths: string[]
  gitDiffTabs: GitDiffTab[]
  /** The unpinned tab that the next single-clicked file replaces. */
  previewTabId: string | null
  activeView: PaneView | null
  browserOpen: boolean
  terminalOpen: boolean
  touchedAt: number
}

interface PersistedDocument {
  version: 1
  workspaces: Record<string, PersistedWorkspaceEntry>
}

interface PersistedWorkspaceEntry {
  openFilePaths: string[]
  previewTabId?: string | null
  activeView: PaneView | null
  browserOpen: boolean
  terminalOpen: boolean
  touchedAt: number
}

export const STORAGE_KEY = 'pi-livecraft.workspace-viewer-state'
const MAX_WORKSPACES = 24
const MAX_OPEN_FILES = 50

export function defaultViewerState(): WorkspaceViewerState {
  return {
    openFilePaths: [],
    gitDiffTabs: [],
    previewTabId: null,
    activeView: null,
    browserOpen: false,
    terminalOpen: false,
    touchedAt: Date.now(),
  }
}

function touch(
  state: WorkspaceViewerState,
  changes: Partial<WorkspaceViewerState>,
): WorkspaceViewerState {
  return { ...state, ...changes, touchedAt: Date.now() }
}

/** Opens a file as the single replaceable preview unless it is already open. */
export function openFile(state: WorkspaceViewerState, path: string): WorkspaceViewerState {
  if (state.openFilePaths.includes(path))
    return touch(state, { activeView: { kind: 'file', path } })
  const previewPath = state.previewTabId?.startsWith('file:') ? state.previewTabId.slice(5) : null
  const openFilePaths = previewPath && state.openFilePaths.includes(previewPath)
    ? state.openFilePaths.map((candidate) => candidate === previewPath ? path : candidate)
    : [...state.openFilePaths, path]
  const gitDiffTabs = state.previewTabId?.startsWith('git:')
    ? state.gitDiffTabs.filter((tab) => tab.id !== state.previewTabId)
    : state.gitDiffTabs
  return touch(state, {
    openFilePaths,
    gitDiffTabs,
    previewTabId: `file:${path}`,
    activeView: { kind: 'file', path },
  })
}

/** Opens a Git diff as the single replaceable preview. */
export function openGitDiff(
  state: WorkspaceViewerState,
  path: string,
  diff: string,
  before: string,
  beforeAvailable: boolean,
  after: string,
  afterAvailable: boolean,
  commitHash?: string,
): WorkspaceViewerState {
  const id = `git:${commitHash ?? 'working-tree'}:${path}`
  if (state.gitDiffTabs.some((tab) => tab.id === id))
    return touch(state, { activeView: { kind: 'git-diff', id } })
  const previewPath = state.previewTabId?.startsWith('file:') ? state.previewTabId.slice(5) : null
  const openFilePaths = previewPath
    ? state.openFilePaths.filter((candidate) => candidate !== previewPath)
    : state.openFilePaths
  const gitDiffTabs = [
    ...state.gitDiffTabs.filter((tab) => tab.id !== state.previewTabId),
    { id, path, commitHash, diff, before, beforeAvailable, after, afterAvailable },
  ]
  return touch(state, {
    openFilePaths,
    gitDiffTabs,
    previewTabId: id,
    activeView: { kind: 'git-diff', id },
  })
}

export function pinTab(state: WorkspaceViewerState, id: string): WorkspaceViewerState {
  return state.previewTabId === id ? touch(state, { previewTabId: null }) : state
}

export function activateFile(state: WorkspaceViewerState, path: string): WorkspaceViewerState {
  if (!state.openFilePaths.includes(path)) return state
  return touch(state, { activeView: { kind: 'file', path } })
}

export function activateGitDiff(state: WorkspaceViewerState, id: string): WorkspaceViewerState {
  if (!state.gitDiffTabs.some((tab) => tab.id === id)) return state
  return touch(state, { activeView: { kind: 'git-diff', id } })
}

export function closeFile(
  state: WorkspaceViewerState,
  path: string,
  browserId: string,
  terminalId: string,
): WorkspaceViewerState {
  const openFilePaths = state.openFilePaths.filter((candidate) => candidate !== path)
  if (openFilePaths.length === state.openFilePaths.length) return state
  const activeView = state.activeView?.kind === 'file' && state.activeView.path === path
    ? fallbackView(
      openFilePaths,
      state.gitDiffTabs,
      state.browserOpen,
      state.terminalOpen,
      browserId,
      terminalId,
    )
    : state.activeView
  return touch(state, {
    openFilePaths,
    previewTabId: state.previewTabId === `file:${path}` ? null : state.previewTabId,
    activeView,
  })
}

export function closeGitDiff(
  state: WorkspaceViewerState,
  id: string,
  browserId: string,
  terminalId: string,
): WorkspaceViewerState {
  const gitDiffTabs = state.gitDiffTabs.filter((tab) => tab.id !== id)
  if (gitDiffTabs.length === state.gitDiffTabs.length) return state
  const activeView = state.activeView?.kind === 'git-diff' && state.activeView.id === id
    ? fallbackView(
      state.openFilePaths,
      gitDiffTabs,
      state.browserOpen,
      state.terminalOpen,
      browserId,
      terminalId,
    )
    : state.activeView
  return touch(state, {
    gitDiffTabs,
    previewTabId: state.previewTabId === id ? null : state.previewTabId,
    activeView,
  })
}

export function openBrowser(state: WorkspaceViewerState, browserId: string): WorkspaceViewerState {
  return touch(state, { browserOpen: true, activeView: { kind: 'browser', browserId } })
}
export function activateBrowser(
  state: WorkspaceViewerState,
  browserId: string,
): WorkspaceViewerState {
  return state.browserOpen ? touch(state, { activeView: { kind: 'browser', browserId } }) : state
}
export function closeBrowser(
  state: WorkspaceViewerState,
  browserId: string,
  terminalId: string,
): WorkspaceViewerState {
  if (!state.browserOpen) return state
  return touch(state, {
    browserOpen: false,
    activeView: state.activeView?.kind === 'browser'
      ? fallbackView(
        state.openFilePaths,
        state.gitDiffTabs,
        false,
        state.terminalOpen,
        browserId,
        terminalId,
      )
      : state.activeView,
  })
}
export function openTerminal(
  state: WorkspaceViewerState,
  terminalId: string,
): WorkspaceViewerState {
  return touch(state, { terminalOpen: true, activeView: { kind: 'terminal', terminalId } })
}
export function activateTerminal(
  state: WorkspaceViewerState,
  terminalId: string,
): WorkspaceViewerState {
  return state.terminalOpen ? touch(state, { activeView: { kind: 'terminal', terminalId } }) : state
}
export function closeTerminal(
  state: WorkspaceViewerState,
  browserId: string,
  terminalId: string,
): WorkspaceViewerState {
  if (!state.terminalOpen) return state
  return touch(state, {
    terminalOpen: false,
    activeView: state.activeView?.kind === 'terminal'
      ? fallbackView(
        state.openFilePaths,
        state.gitDiffTabs,
        state.browserOpen,
        false,
        browserId,
        terminalId,
      )
      : state.activeView,
  })
}

export function fallbackView(
  openFilePaths: readonly string[],
  gitDiffTabs: readonly GitDiffTab[],
  browserOpen: boolean,
  terminalOpen: boolean,
  browserId: string,
  terminalId: string,
): PaneView | null {
  const lastFile = openFilePaths.at(-1)
  if (lastFile !== undefined) return { kind: 'file', path: lastFile }
  const lastDiff = gitDiffTabs.at(-1)
  if (lastDiff) return { kind: 'git-diff', id: lastDiff.id }
  if (browserOpen) return { kind: 'browser', browserId }
  if (terminalOpen) return { kind: 'terminal', terminalId }
  return null
}

export function readPersistedStates(raw: string | null): Record<string, WorkspaceViewerState> {
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)) return {}
    const doc = parsed as unknown as PersistedDocument
    if (doc.version !== 1 || !isObject(doc.workspaces)) return {}
    return Object.fromEntries(
      Object
        .entries(doc.workspaces as Record<string, unknown>)
        .map(([key, entry]) => [key, restoreEntry(entry)] as const)
        .filter((entry): entry is readonly [string, WorkspaceViewerState] => entry[1] !== null)
        .sort(([, left], [, right]) => right.touchedAt - left.touchedAt)
        .slice(0, MAX_WORKSPACES),
    )
  } catch {
    return {}
  }
}
function restoreEntry(raw: unknown): WorkspaceViewerState | null {
  if (!isObject(raw)) return null
  const entry = raw as Partial<PersistedWorkspaceEntry>
  if (!Array.isArray(entry.openFilePaths)) return null
  const openFilePaths = deduplicateAndBound(
    entry.openFilePaths.filter(isValidRelativePath),
    MAX_OPEN_FILES,
  )
  const browserOpen = entry.browserOpen === true
  const terminalOpen = entry.terminalOpen === true
  const previewTabId =
    typeof entry.previewTabId === 'string' && entry.previewTabId.startsWith('file:')
      && openFilePaths.includes(entry.previewTabId.slice(5))
      ? entry.previewTabId
      : null
  const activeView = restoreActiveView(entry.activeView, openFilePaths, browserOpen, terminalOpen)
  return {
    openFilePaths,
    gitDiffTabs: [],
    previewTabId,
    activeView,
    browserOpen,
    terminalOpen,
    touchedAt: typeof entry.touchedAt === 'number' && entry.touchedAt > 0 ? entry.touchedAt : 0,
  }
}
function restoreActiveView(
  raw: unknown,
  openFilePaths: string[],
  browserOpen: boolean,
  terminalOpen: boolean,
): PaneView | null {
  if (!isObject(raw)) return null
  const view = raw as PaneView
  if (view.kind === 'file' && typeof view.path === 'string' && openFilePaths.includes(view.path))
    return view
  if (view.kind === 'browser' && typeof view.browserId === 'string' && browserOpen) return view
  if (view.kind === 'terminal' && typeof view.terminalId === 'string' && terminalOpen) return view
  return null
}
export function writePersistedStates(states: Record<string, WorkspaceViewerState>): string {
  const workspaces: Record<string, PersistedWorkspaceEntry> = {}
  for (
    const [key, state] of Object
      .entries(states)
      .sort(([, a], [, b]) => b.touchedAt - a.touchedAt)
      .slice(0, MAX_WORKSPACES)
  ) {
    workspaces[key] = {
      openFilePaths: state.openFilePaths.slice(0, MAX_OPEN_FILES),
      previewTabId: state.previewTabId?.startsWith('file:') ? state.previewTabId : null,
      activeView: state.activeView?.kind === 'git-diff' ? null : state.activeView,
      browserOpen: state.browserOpen,
      terminalOpen: state.terminalOpen,
      touchedAt: state.touchedAt,
    }
  }
  return JSON.stringify({ version: 1, workspaces } satisfies PersistedDocument)
}
function isValidRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed !== '' && !trimmed.startsWith('/') && !trimmed.startsWith('\\')
    && !trimmed.split(/[\\/]/).some((segment) => segment === '..' || segment === '.')
}
function deduplicateAndBound(values: string[], limit: number): string[] {
  return [...new Set(values)].slice(0, limit)
}
