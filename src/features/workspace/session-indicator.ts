import type { SessionSummary } from '../../../shared/types.ts'
import { isAgentSelector, isBlockingDialog } from '../dialogs/dialog-protocol.ts'

export type SessionIndicator = 'working' | 'waiting' | 'compacting' | 'complete' | 'idle'

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
