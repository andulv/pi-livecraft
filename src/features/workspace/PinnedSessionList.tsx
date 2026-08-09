import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { GitWorkspace, RecentSession, SessionSummary } from '../../../shared/types.ts'
import { sessionIndicator, type SessionIndicator } from './session-indicator.ts'
import { SessionStatusIndicator } from './SessionStatusIndicator.tsx'
import type { SessionActionTarget } from './sidebar-sessions.ts'

/** Renders project-level session pins independently of the selected workspace list. */
export function PinnedSessionList({
  compactingSessionIds,
  completedSessionIds,
  onError,
  onOpenActions,
  onOpenSession,
  pinnedSessions,
  selectedId,
  sessions,
  workspaces,
}: {
  compactingSessionIds: ReadonlySet<string>
  completedSessionIds: ReadonlySet<string>
  onError: (cause: unknown) => void
  onOpenActions: (
    target: SessionActionTarget,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void
  onOpenSession: (session: RecentSession) => Promise<void>
  pinnedSessions: RecentSession[]
  selectedId: string
  sessions: SessionSummary[]
  workspaces: GitWorkspace[]
}) {
  const [openingSessionPath, setOpeningSessionPath] = useState('')

  function openSession(session: RecentSession): void {
    setOpeningSessionPath(session.sessionPath)
    void onOpenSession(session).catch(onError).finally(() => setOpeningSessionPath(''))
  }

  return (
    <nav aria-label='Pinned project sessions' className='pinned-session-list'>
      {pinnedSessions.map((pinnedSession) => {
        const activeSession = sessions.find((session) =>
          session.sessionPath === pinnedSession.sessionPath && session.status !== 'exited'
        )
        const indicator = sessionIndicator(
          activeSession,
          selectedId,
          compactingSessionIds,
          completedSessionIds,
        )
        const workspace = workspaces.find(({ path }) => path === pinnedSession.cwd)
        const sessionLabel = openingSessionPath === pinnedSession.sessionPath
          ? 'Opening…'
          : pinnedSession.name
        const actionTarget: SessionActionTarget = {
          cwd: pinnedSession.cwd,
          name: pinnedSession.name,
          sessionId: activeSession?.id,
          sessionPath: pinnedSession.sessionPath,
        }
        return (
          <div className='session-row pinned-session-row' key={pinnedSession.sessionPath}>
            <Tooltip label={`${pinnedSession.name}\n${pinnedSession.cwd}`}>
              <button
                className={sessionClassName(activeSession, selectedId, indicator)}
                disabled={openingSessionPath === pinnedSession.sessionPath}
                onClick={() => openSession(pinnedSession)}
                type='button'
              >
                <PinIcon />
                {indicator && <SessionStatusIndicator status={indicator} />}
                <span>
                  <strong>{sessionLabel}</strong>
                  <small>{workspace?.branch ?? pinnedSession.cwd}</small>
                </span>
              </button>
            </Tooltip>
            <SessionActions target={actionTarget} onOpen={onOpenActions} />
          </div>
        )
      })}
    </nav>
  )
}

function sessionClassName(
  activeSession: SessionSummary | undefined,
  selectedId: string,
  indicator: SessionIndicator | null,
): string {
  return `session-item${activeSession?.id === selectedId ? ' selected' : ''}${
    indicator ? ` ${indicator}` : ''
  }`
}

function SessionActions({
  target,
  onOpen,
}: {
  target: SessionActionTarget
  onOpen: (target: SessionActionTarget, event: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <Tooltip label='Session actions'>
      <button
        aria-haspopup='menu'
        aria-label={`Session actions for ${target.name}`}
        className='session-actions'
        onClick={(event) => onOpen(target, event)}
        type='button'
      >
        …
      </button>
    </Tooltip>
  )
}

function PinIcon() {
  return (
    <svg
      aria-hidden='true'
      className='pinned-session-icon'
      fill='none'
      height='14'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.6'
      viewBox='0 0 24 24'
      width='14'
    >
      <path d='M12 17v5' />
      <path d='M9 10.8a2 2 0 0 1-1.1 1.8L5 14v2h14v-2l-2.9-1.4a2 2 0 0 1-1.1-1.8V6a1 1 0 0 1 1-1V3H8v2a1 1 0 0 1 1 1v4.8Z' />
    </svg>
  )
}
