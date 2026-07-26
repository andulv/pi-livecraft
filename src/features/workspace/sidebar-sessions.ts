import type { RecentSession, SessionSummary } from '../../../shared/types.ts'

/** Keeps optimistic entries while their session is active, independently of a changing session path. */
export function reconcileRecentSessions(current: RecentSession[], fetched: RecentSession[], activeSessions: SessionSummary[]): RecentSession[] {
  const fetchedIds = new Set(fetched.map((session) => session.id))
  const fetchedPaths = new Set(fetched.map((session) => session.sessionPath))
  const activeIds = new Set(activeSessions.filter((session) => session.status !== 'exited').map((session) => session.id))
  return [...fetched, ...current.filter((session) => activeIds.has(session.id) && !fetchedIds.has(session.id) && !fetchedPaths.has(session.sessionPath))]
}

/** Keeps the sidebar limited to persisted sessions from the current workspace. */
export function sidebarSessions(recentSessions: RecentSession[], workspacePath: string): RecentSession[] {
  return recentSessions.filter(({ cwd }) => cwd === workspacePath)
}
