import type { RecentSession, SessionSummary } from '../../../shared/types.ts'
import { sessionIndicator } from './session-indicator.ts'

export interface SessionActionTarget {
  cwd: string
  name: string
  sessionId?: string
  sessionPath?: string
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

/** Lists attention-worthy sessions outside the current workspace, with active work first. */
export function otherWorkspaceSessions(
  sessions: SessionSummary[],
  workspacePath: string,
  compactingSessionIds: ReadonlySet<string>,
  completedSessionIds: ReadonlySet<string>,
): SessionSummary[] {
  const relevant = sessions.filter((session) =>
    session.cwd !== workspacePath
    && session.status !== 'exited'
    && sessionIndicator(session, '', compactingSessionIds, completedSessionIds) !== null
    && sessionIndicator(session, '', compactingSessionIds, completedSessionIds) !== 'idle'
  )
  return [
    ...relevant.filter((session) =>
      sessionIndicator(session, '', compactingSessionIds, completedSessionIds) !== 'complete'
    ),
    ...relevant.filter((session) =>
      sessionIndicator(session, '', compactingSessionIds, completedSessionIds) === 'complete'
    ),
  ]
}

/**
 * Picks the session to auto-select when opening a workspace.
 * Priority: most recent completed unviewed session → most recent active session → none.
 */
export function pickSessionOnOpen(
  visibleSessions: RecentSession[],
  activeSessions: SessionSummary[],
  completedSessionIds: ReadonlySet<string>,
): string | null {
  for (const visible of visibleSessions) {
    const active = activeSessions.find(
      (s) => s.sessionPath === visible.sessionPath && s.status !== 'exited',
    )
    if (active && active.status === 'idle' && completedSessionIds.has(visible.sessionPath)) {
      return active.id
    }
  }
  for (const visible of visibleSessions) {
    const active = activeSessions.find(
      (s) => s.sessionPath === visible.sessionPath && s.status !== 'exited',
    )
    if (active && (active.status === 'starting' || active.status === 'running')) {
      return active.id
    }
  }
  return null
}
