import type { GitWorkspace, RecentSession, SessionSummary } from '../../../shared/types.ts'
import { sessionIndicator } from './session-indicator.ts'

export interface SessionActionTarget {
  cwd: string
  name: string
  sessionId?: string
  sessionPath?: string
}

/** Returns the newest known activity across persisted and optimistic sessions in a workspace. */
export function workspaceActivity(
  workspacePath: string,
  recentSessions: readonly RecentSession[],
  sentSessions: readonly RecentSession[] = [],
): number {
  return [...recentSessions, ...sentSessions]
    .filter(({ cwd }) => cwd === workspacePath)
    .reduce((latest, { updatedAt }) => Math.max(latest, updatedAt), 0)
}

/** Keeps the primary checkout first, then orders linked worktrees by latest activity. */
export function compareWorkspaces(
  left: GitWorkspace,
  right: GitWorkspace,
  recentSessions: readonly RecentSession[],
  sentSessions: readonly RecentSession[] = [],
): number {
  if (left.main !== right.main) return left.main ? -1 : 1
  return workspaceActivity(right.path, recentSessions, sentSessions)
    - workspaceActivity(left.path, recentSessions, sentSessions)
}

/** Adds pending sessions and orders the visible list by latest activity. */
export function sidebarSessions(
  recentSessions: RecentSession[],
  workspacePath: string,
  sentSessions: RecentSession[] = [],
): RecentSession[] {
  const recentIds = new Set(recentSessions.map((session) => session.id))
  const recentPaths = new Set(recentSessions.map((session) => session.sessionPath))
  const pending = sentSessions.filter((session) =>
    !recentIds.has(session.id) && !recentPaths.has(session.sessionPath)
  )
  return [...pending, ...recentSessions]
    .filter(({ cwd }) => cwd === workspacePath)
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

/** Finds a live, message-free session that can satisfy the new-session action. */
export function reusableNewSession(
  sessions: SessionSummary[],
  recentSessions: RecentSession[],
  workspacePath: string,
): SessionSummary | null {
  const persistedPaths = new Set(recentSessions.map(({ sessionPath }) => sessionPath))
  return sessions.find((session) =>
    session.cwd === workspacePath
    && session.name === 'New session'
    && session.status !== 'exited'
    && (!session.sessionPath || !persistedPaths.has(session.sessionPath))
  ) ?? null
}

/** Picks the next visible active session after closing the selected one. */
export function nextActiveSessionId(
  closedSessionId: string,
  sessions: SessionSummary[],
  recentSessions: RecentSession[],
  workspacePath: string,
  sentSessions: RecentSession[] = [],
): string | null {
  const activeIds = sidebarSessions(recentSessions, workspacePath, sentSessions).flatMap(
    (recent) => {
      const active = sessions.find((session) =>
        session.sessionPath === recent.sessionPath && session.status !== 'exited'
      )
      return active ? [active.id] : []
    },
  )
  const closedIndex = activeIds.indexOf(closedSessionId)
  return closedIndex >= 0
    ? activeIds[closedIndex + 1] ?? activeIds[closedIndex - 1] ?? null
    : activeIds[0] ?? null
}

/** Lists attention-worthy sessions outside the current workspace by latest known activity. */
export function otherWorkspaceSessions(
  sessions: SessionSummary[],
  workspacePath: string,
  compactingSessionIds: ReadonlySet<string>,
  completedSessionIds: ReadonlySet<string>,
  recentSessions: readonly RecentSession[] = [],
): SessionSummary[] {
  const relevant = sessions.filter((session) =>
    session.cwd !== workspacePath
    && session.status !== 'exited'
    && sessionIndicator(session, '', compactingSessionIds, completedSessionIds) !== null
    && sessionIndicator(session, '', compactingSessionIds, completedSessionIds) !== 'idle'
  )
  const activityBySessionPath = new Map(
    recentSessions.map(({ sessionPath, updatedAt }) => [sessionPath, updatedAt]),
  )
  return relevant.sort((left, right) =>
    (activityBySessionPath.get(right.sessionPath ?? '') ?? 0)
    - (activityBySessionPath.get(left.sessionPath ?? '') ?? 0)
  )
}

export interface WorkspaceSessionTarget {
  sessionPath: string
  activeSessionId?: string
}

/** Picks the newest visible session, reopening it when no live process owns it. */
export function newestWorkspaceSession(
  visibleSessions: RecentSession[],
  activeSessions: SessionSummary[],
): WorkspaceSessionTarget | null {
  const newest = visibleSessions[0]
  if (!newest) return null
  const active = activeSessions.find(
    (session) => session.sessionPath === newest.sessionPath && session.status !== 'exited',
  )
  return { sessionPath: newest.sessionPath, activeSessionId: active?.id }
}
