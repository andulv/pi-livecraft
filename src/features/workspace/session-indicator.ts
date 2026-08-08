import type { SessionSummary } from '../../../shared/types.ts'
import { isAgentSelector, isBlockingDialog } from '../dialogs/dialog-protocol.ts'

export type SessionIndicator = 'working' | 'waiting' | 'compacting' | 'complete' | 'idle'

const indicatorPriority: Record<SessionIndicator, number> = {
  waiting: 5,
  compacting: 4,
  working: 3,
  complete: 2,
  idle: 1,
}

/** Returns the highest-priority state to surface beside a live Pi session. */
export function sessionIndicator(
  session: SessionSummary | undefined,
  selectedId: string,
  compactingSessionIds: ReadonlySet<string>,
  completedSessionIds: ReadonlySet<string>,
): SessionIndicator | null {
  if (!session) return null
  if (session.pendingUi.some((request) => isBlockingDialog(request) && !isAgentSelector(request)))
    return 'waiting'
  if (compactingSessionIds.has(session.id)) return 'compacting'
  if (session.status === 'starting' || session.status === 'running') return 'working'
  if (
    session.status === 'idle' && session.id !== selectedId
    && completedSessionIds.has(session.sessionPath ?? session.id)
  ) return 'complete'
  if (session.status === 'idle') return 'idle'
  return null
}

/** Rolls up live session state so collapsed workspaces and projects still surface attention. */
export function aggregateSessionIndicator(
  sessions: Iterable<SessionSummary>,
  selectedId: string,
  compactingSessionIds: ReadonlySet<string>,
  completedSessionIds: ReadonlySet<string>,
): SessionIndicator | null {
  let aggregate: SessionIndicator | null = null
  for (const session of sessions) {
    const status = sessionIndicator(session, selectedId, compactingSessionIds, completedSessionIds)
    if (status && (!aggregate || indicatorPriority[status] > indicatorPriority[aggregate]))
      aggregate = status
  }
  return aggregate
}
