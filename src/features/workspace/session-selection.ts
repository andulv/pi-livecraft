import type { RecentSession, SessionSummary } from '../../../shared/types.ts'
import { newestWorkspaceSession, type WorkspaceSessionTarget } from './sidebar-sessions.ts'

/** Restore URL/remembered selection without retrying a missing or relocated path
 * as the newest session. Failure to open the actual fallback still surfaces normally.
 */
export async function restoreWorkspaceSession({
  cwd,
  preferredPaths,
  visibleSessions,
  activeSessions,
  openTarget,
  onStalePath,
}: {
  cwd: string
  preferredPaths: readonly (string | undefined)[]
  visibleSessions: RecentSession[]
  activeSessions: SessionSummary[]
  openTarget: (target: WorkspaceSessionTarget) => Promise<string | undefined>
  onStalePath: (path: string) => void
}): Promise<string | undefined> {
  const failedPaths = new Set<string>()
  for (const path of preferredPaths) {
    if (!path || failedPaths.has(path)) continue
    const active = activeSessions.find((session) =>
      session.sessionPath === path && session.status !== 'exited'
    )
    if (active && active.cwd !== cwd) {
      failedPaths.add(path)
      onStalePath(path)
      continue
    }
    try {
      return await openTarget({ sessionPath: path, activeSessionId: active?.id })
    } catch {
      failedPaths.add(path)
      onStalePath(path)
    }
  }
  const target = newestWorkspaceSession(
    visibleSessions.filter(({ sessionPath }) => !failedPaths.has(sessionPath)),
    activeSessions.filter((session) => session.cwd === cwd),
  )
  return target ? await openTarget(target) : undefined
}

/** Draft-bearing new sessions stay live across navigation; empty ones are disposable. */
export function discardableNewSessions(
  transientIds: ReadonlySet<string>,
  draftMessages: ReadonlyMap<string, string>,
  nextSessionId?: string,
): string[] {
  return [...transientIds].filter((id) => id !== nextSessionId && !draftMessages.get(id)?.trim())
}
