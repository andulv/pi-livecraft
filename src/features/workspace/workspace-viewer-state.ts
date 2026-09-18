/**
 * Pure workspace viewer-state model. Each canonical workspace path owns an
 * independent set of open file tabs, an active view, and browser/terminal
 * openness. All transitions are pure functions; persistence uses a versioned
 * localStorage document bounded by workspace count and file-tab count.
 *
 * This module has no React dependency and is tested independently.
 */

import { isObject } from '../../../shared/is-object.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The viewer pane shows either one open file, the browser tab, or the terminal tab. */
export type PaneView =
  | { kind: 'file'; path: string }
  | { kind: 'browser'; browserId: string }
  | { kind: 'terminal'; terminalId: string }

/** Per-workspace viewer state. Extensible with future per-workspace UI data. */
export interface WorkspaceViewerState {
  openFilePaths: string[]
  activeView: PaneView | null
  browserOpen: boolean
  terminalOpen: boolean
  /** Epoch ms — tracks recency for eviction during persistence. */
  touchedAt: number
}

interface PersistedDocument {
  version: 1
  workspaces: Record<string, PersistedWorkspaceEntry>
}

interface PersistedWorkspaceEntry {
  openFilePaths: string[]
  activeView: PaneView | null
  browserOpen: boolean
  terminalOpen: boolean
  touchedAt: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'pi-livecraft.workspace-viewer-state'

/** Maximum workspace entries kept in localStorage. */
const MAX_WORKSPACES = 24

/** Maximum open file paths stored per workspace. */
const MAX_OPEN_FILES = 50

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

export function defaultViewerState(): WorkspaceViewerState {
  return {
    openFilePaths: [],
    activeView: null,
    browserOpen: false,
    terminalOpen: false,
    touchedAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Pure transitions
// ---------------------------------------------------------------------------

/** Opens a file tab (appending if new) and activates it. */
export function openFile(state: WorkspaceViewerState, path: string): WorkspaceViewerState {
  const openFilePaths = state.openFilePaths.includes(path)
    ? state.openFilePaths
    : [...state.openFilePaths, path]
  return { ...state, openFilePaths, activeView: { kind: 'file', path }, touchedAt: Date.now() }
}

/** Activates an already-open file tab. No-op if the path is not open. */
export function activateFile(state: WorkspaceViewerState, path: string): WorkspaceViewerState {
  if (!state.openFilePaths.includes(path)) return state
  return { ...state, activeView: { kind: 'file', path }, touchedAt: Date.now() }
}

/**
 * Closes a file tab. When the closed tab was active, falls back to the nearest
 * remaining file, then browser, then terminal, then null.
 */
export function closeFile(
  state: WorkspaceViewerState,
  path: string,
  browserId: string,
  terminalId: string,
): WorkspaceViewerState {
  const openFilePaths = state.openFilePaths.filter((candidate) => candidate !== path)
  if (openFilePaths.length === state.openFilePaths.length) return state
  const activeView = state.activeView?.kind === 'file' && state.activeView.path === path
    ? fallbackView(openFilePaths, state.browserOpen, state.terminalOpen, browserId, terminalId)
    : state.activeView
  return { ...state, openFilePaths, activeView, touchedAt: Date.now() }
}

/** Opens the browser tab and activates it. */
export function openBrowser(state: WorkspaceViewerState, browserId: string): WorkspaceViewerState {
  return {
    ...state,
    browserOpen: true,
    activeView: { kind: 'browser', browserId },
    touchedAt: Date.now(),
  }
}

/** Activates the browser tab. No-op if browser is not open. */
export function activateBrowser(
  state: WorkspaceViewerState,
  browserId: string,
): WorkspaceViewerState {
  if (!state.browserOpen) return state
  return { ...state, activeView: { kind: 'browser', browserId }, touchedAt: Date.now() }
}

/**
 * Closes the browser tab. When it was active, falls back to the last open file,
 * then terminal, then null.
 */
export function closeBrowser(
  state: WorkspaceViewerState,
  browserId: string,
  terminalId: string,
): WorkspaceViewerState {
  if (!state.browserOpen) return state
  const activeView = state.activeView?.kind === 'browser'
    ? fallbackView(state.openFilePaths, false, state.terminalOpen, browserId, terminalId)
    : state.activeView
  return { ...state, browserOpen: false, activeView, touchedAt: Date.now() }
}

/** Opens the terminal tab and activates it. */
export function openTerminal(
  state: WorkspaceViewerState,
  terminalId: string,
): WorkspaceViewerState {
  return {
    ...state,
    terminalOpen: true,
    activeView: { kind: 'terminal', terminalId },
    touchedAt: Date.now(),
  }
}

/** Activates the terminal tab. No-op if terminal is not open. */
export function activateTerminal(
  state: WorkspaceViewerState,
  terminalId: string,
): WorkspaceViewerState {
  if (!state.terminalOpen) return state
  return { ...state, activeView: { kind: 'terminal', terminalId }, touchedAt: Date.now() }
}

/**
 * Closes the terminal tab. When it was active, falls back to the last open file,
 * then browser, then null.
 */
export function closeTerminal(
  state: WorkspaceViewerState,
  browserId: string,
  terminalId: string,
): WorkspaceViewerState {
  if (!state.terminalOpen) return state
  const activeView = state.activeView?.kind === 'terminal'
    ? fallbackView(state.openFilePaths, state.browserOpen, false, browserId, terminalId)
    : state.activeView
  return { ...state, terminalOpen: false, activeView, touchedAt: Date.now() }
}

// ---------------------------------------------------------------------------
// Fallback selection
// ---------------------------------------------------------------------------

/**
 * Deterministic fallback: last open file → browser (if open) → terminal (if
 * open) → null.
 */
export function fallbackView(
  openFilePaths: readonly string[],
  browserOpen: boolean,
  terminalOpen: boolean,
  browserId: string,
  terminalId: string,
): PaneView | null {
  const lastFile = openFilePaths.at(-1)
  if (lastFile !== undefined) return { kind: 'file', path: lastFile }
  if (browserOpen) return { kind: 'browser', browserId }
  if (terminalOpen) return { kind: 'terminal', terminalId }
  return null
}

// ---------------------------------------------------------------------------
// Persistence — reading
// ---------------------------------------------------------------------------

/** Safely reads the persisted workspace viewer states from a raw localStorage value. */
export function readPersistedStates(raw: string | null): Record<string, WorkspaceViewerState> {
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)) return {}
    const doc = parsed as unknown as PersistedDocument
    if (doc.version !== 1) return {}
    const workspaces = doc.workspaces
    if (!isObject(workspaces)) return {}
    const result: Record<string, WorkspaceViewerState> = {}
    for (const [key, entry] of Object.entries(workspaces as Record<string, unknown>)) {
      const restored = restoreEntry(entry)
      if (restored) result[key] = restored
    }
    return result
  } catch {
    return {}
  }
}

/** Validates and sanitizes one workspace entry from a persisted document. */
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
  const activeView = restoreActiveView(entry.activeView, openFilePaths, browserOpen, terminalOpen)
  const touchedAt = typeof entry.touchedAt === 'number' && entry.touchedAt > 0
    ? entry.touchedAt
    : 0
  return { openFilePaths, activeView, browserOpen, terminalOpen, touchedAt }
}

/** Restores an activeView, repairing it through fallback when invalid. */
function restoreActiveView(
  raw: unknown,
  openFilePaths: string[],
  browserOpen: boolean,
  terminalOpen: boolean,
): PaneView | null {
  if (!isObject(raw)) return null
  const view = raw as PaneView
  if (view.kind === 'file' && typeof view.path === 'string' && openFilePaths.includes(view.path)) {
    return view
  }
  if (view.kind === 'browser' && typeof view.browserId === 'string' && browserOpen) return view
  if (view.kind === 'terminal' && typeof view.terminalId === 'string' && terminalOpen) return view
  // Invalid active view — do not guess; return null so the UI starts at the
  // default empty state rather than activating a stale tab.
  return null
}

// ---------------------------------------------------------------------------
// Persistence — writing
// ---------------------------------------------------------------------------

/** Serializes workspace viewer states for localStorage, bounded and evicted. */
export function writePersistedStates(states: Record<string, WorkspaceViewerState>): string {
  const entries = Object.entries(states)
  // Evict least-recently-touched workspaces when over the limit.
  entries.sort(([, a], [, b]) => b.touchedAt - a.touchedAt)
  const kept = entries.slice(0, MAX_WORKSPACES)
  const workspaces: Record<string, PersistedWorkspaceEntry> = {}
  for (const [key, state] of kept) {
    workspaces[key] = {
      openFilePaths: state.openFilePaths.slice(0, MAX_OPEN_FILES),
      activeView: state.activeView,
      browserOpen: state.browserOpen,
      terminalOpen: state.terminalOpen,
      touchedAt: state.touchedAt,
    }
  }
  const document: PersistedDocument = { version: 1, workspaces }
  return JSON.stringify(document)
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/** Returns true for non-empty relative paths without traversal. */
function isValidRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.startsWith('/') || trimmed.startsWith('\\')) return false
  const segments = trimmed.split(/[\\/]/)
  return !segments.some((segment) => segment === '..' || segment === '.')
}

/** Deduplicates strings preserving order and caps at the given limit. */
function deduplicateAndBound(values: string[], limit: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (result.length >= limit) break
  }
  return result
}
