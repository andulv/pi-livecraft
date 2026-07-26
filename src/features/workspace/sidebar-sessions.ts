import type { RecentSession } from '../../../shared/types.ts'

/** Adds only sent sessions still missing from persistence, preserving the server order otherwise. */
export function sidebarSessions(recentSessions: RecentSession[], workspacePath: string, sentSessions: RecentSession[] = []): RecentSession[] {
  const recentIds = new Set(recentSessions.map((session) => session.id))
  const recentPaths = new Set(recentSessions.map((session) => session.sessionPath))
  const pending = sentSessions.filter((session) => !recentIds.has(session.id) && !recentPaths.has(session.sessionPath))
  return [...pending, ...recentSessions].filter(({ cwd }) => cwd === workspacePath)
}
