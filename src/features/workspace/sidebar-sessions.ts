import type { RecentSession } from '../../../shared/types.ts'

/** Keeps locally sent sessions visible first while adopting metadata returned by persistence. */
export function sidebarSessions(recentSessions: RecentSession[], workspacePath: string, sentSessions: RecentSession[] = []): RecentSession[] {
  const recentById = new Map(recentSessions.map((session) => [session.id, session]))
  const recentByPath = new Map(recentSessions.map((session) => [session.sessionPath, session]))
  const prioritized = sentSessions.map((session) => recentById.get(session.id) ?? recentByPath.get(session.sessionPath) ?? session)
  const prioritizedIds = new Set(prioritized.map((session) => session.id))
  const prioritizedPaths = new Set(prioritized.map((session) => session.sessionPath))
  return [...prioritized, ...recentSessions.filter((session) => !prioritizedIds.has(session.id) && !prioritizedPaths.has(session.sessionPath))]
    .filter(({ cwd }) => cwd === workspacePath)
}
