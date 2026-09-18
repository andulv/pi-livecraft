import { isObject } from '../../../shared/is-object.ts'

/** One remembered session selection for a canonical workspace path. */
export interface WorkspaceSessionSelection {
  sessionPath: string
  touchedAt: number
}

export type WorkspaceSessionSelections = Record<string, WorkspaceSessionSelection>

interface PersistedWorkspaceSessionState {
  version: 1
  workspaces: Record<string, WorkspaceSessionSelection>
}

export const WORKSPACE_SESSION_SELECTION_STORAGE_KEY = 'pi-livecraft.workspace-session-selection'

const maxWorkspaceSelections = 24

/** Reads remembered session paths defensively from localStorage. */
export function readWorkspaceSessionSelections(
  raw: string | null,
): WorkspaceSessionSelections {
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed) || parsed.version !== 1 || !isObject(parsed.workspaces)) return {}
    const entries: Array<[string, WorkspaceSessionSelection]> = []
    for (const [workspacePath, value] of Object.entries(parsed.workspaces)) {
      if (!workspacePath || !isValidSessionPath(value)) continue
      entries.push([workspacePath, value])
    }
    entries.sort(([, left], [, right]) => right.touchedAt - left.touchedAt)
    return Object.fromEntries(entries.slice(0, maxWorkspaceSelections))
  } catch {
    return {}
  }
}

/** Remembers one session path and updates its eviction timestamp. */
export function rememberWorkspaceSession(
  selections: WorkspaceSessionSelections,
  workspacePath: string,
  sessionPath: string,
  touchedAt = Date.now(),
): WorkspaceSessionSelections {
  if (!workspacePath || !sessionPath.trim()) return selections
  return {
    ...selections,
    [workspacePath]: { sessionPath, touchedAt },
  }
}

/** Removes a remembered selection for one workspace. */
export function forgetWorkspaceSession(
  selections: WorkspaceSessionSelections,
  workspacePath: string,
): WorkspaceSessionSelections {
  if (!(workspacePath in selections)) return selections
  const next = { ...selections }
  delete next[workspacePath]
  return next
}

/** Serializes remembered selections, evicting the least recently touched workspaces. */
export function writeWorkspaceSessionSelections(
  selections: WorkspaceSessionSelections,
): string {
  const entries = Object
    .entries(selections)
    .sort(([, left], [, right]) => right.touchedAt - left.touchedAt)
    .slice(0, maxWorkspaceSelections)
  const workspaces = Object.fromEntries(entries)
  const document: PersistedWorkspaceSessionState = { version: 1, workspaces }
  return JSON.stringify(document)
}

function isValidSessionPath(value: unknown): value is WorkspaceSessionSelection {
  return isObject(value)
    && typeof value.sessionPath === 'string'
    && value.sessionPath.trim() !== ''
    && typeof value.touchedAt === 'number'
    && Number.isFinite(value.touchedAt)
    && value.touchedAt >= 0
}
