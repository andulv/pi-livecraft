import type { RecentSession } from '../../../shared/types.ts'

/** Keeps the sidebar limited to persisted sessions from the current workspace. */
export function sidebarSessions(recentSessions: RecentSession[], workspacePath: string): RecentSession[] {
  return recentSessions.filter(({ cwd }) => cwd === workspacePath)
}
