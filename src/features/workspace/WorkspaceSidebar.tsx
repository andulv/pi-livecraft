import { useEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { RecentSession, SessionSummary } from '../../../shared/types.ts'
import { sessionIndicator } from './session-indicator.ts'
import { SessionStatusIndicator } from './SessionStatusIndicator.tsx'
import { otherWorkspaceSessions, sidebarSessions } from './sidebar-sessions.ts'

interface WorkspaceSidebarProps {
  compactingSessionIds: ReadonlySet<string>
  completedSessionIds: ReadonlySet<string>
  isRefreshing: boolean
  recentSessions: RecentSession[]
  sentSessions: RecentSession[]
  sessions: SessionSummary[]
  selectedId: string
  workspacePath: string
  onChooseWorkspace: () => void
  onCreate: () => Promise<void>
  onOpenSession: (session: RecentSession) => Promise<void>
  onSelectOtherWorkspaceSession: (session: SessionSummary) => void
  onSelectSession: (sessionId: string) => void
  onOpenSettings: () => void
  onError: (cause: unknown) => void
}

/** Displays the current workspace and opens or selects its recent Pi sessions. */
export function WorkspaceSidebar({
  compactingSessionIds,
  completedSessionIds,
  isRefreshing,
  recentSessions,
  sentSessions,
  sessions,
  selectedId,
  workspacePath,
  onChooseWorkspace,
  onCreate,
  onOpenSession,
  onSelectOtherWorkspaceSession,
  onSelectSession,
  onOpenSettings,
  onError,
}: WorkspaceSidebarProps) {
  const [openingSessionPath, setOpeningSessionPath] = useState('')
  const selectedSessionRef = useRef<HTMLButtonElement>(null)
  const visibleSessions = useMemo(
    () => sidebarSessions(recentSessions, workspacePath, sentSessions),
    [recentSessions, sentSessions, workspacePath],
  )
  const otherSessions = useMemo(
    () =>
      otherWorkspaceSessions(sessions, workspacePath, compactingSessionIds, completedSessionIds),
    [compactingSessionIds, completedSessionIds, sessions, workspacePath],
  )

  useEffect(() => {
    selectedSessionRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, visibleSessions])

  return (
    <aside className='sidebar'>
      <div className='brand'>
        <span className='brand-mark'>π</span>
        <div>
          <strong>Pi Livecraft</strong>
          <small>Local workspace</small>
        </div>
        <Tooltip label='Settings'>
          <button
            aria-label='Open settings'
            className='theme-toggle'
            onClick={onOpenSettings}
            type='button'
          >
            <SettingsIcon />
          </button>
        </Tooltip>
      </div>
      <div className='workspace-group'>
        <Tooltip label={workspacePath}>
          <button className='workspace-path' onClick={onChooseWorkspace} type='button'>
            <span>Current directory</span>
            <strong>{workspacePath}</strong>
          </button>
        </Tooltip>
      </div>
      <NewSessionButton onCreate={onCreate} onError={onError} />
      <nav className='session-list' aria-label='Recent Pi sessions'>
        {isRefreshing && visibleSessions.length === 0 && (
          <p className='session-list-loading' role='status'>Loading sessions…</p>
        )}
        {visibleSessions.map((recentSession) => {
          const activeSession = sessions.find((session) =>
            session.sessionPath === recentSession.sessionPath && session.status !== 'exited'
          )
          const indicator = sessionIndicator(
            activeSession,
            selectedId,
            compactingSessionIds,
            completedSessionIds,
          )
          const sessionLabel = openingSessionPath === recentSession.sessionPath
            ? 'Opening…'
            : recentSession.name
          return (
            <Tooltip
              key={recentSession.sessionPath}
              label={`${recentSession.name}\n${
                new Date(recentSession.updatedAt).toLocaleString('en-US')
              }`}
            >
              <button
                className={`session-item${activeSession?.id === selectedId ? ' selected' : ''}${
                  indicator ? ` ${indicator}` : ''
                }`}
                disabled={openingSessionPath === recentSession.sessionPath}
                onClick={() => {
                  if (activeSession) {
                    onSelectSession(activeSession.id)
                    return
                  }
                  setOpeningSessionPath(recentSession.sessionPath)
                  void onOpenSession(recentSession).catch(onError).finally(() =>
                    setOpeningSessionPath('')
                  )
                }}
                ref={activeSession?.id === selectedId ? selectedSessionRef : undefined}
                type='button'
              >
                {indicator && <SessionStatusIndicator status={indicator} />}
                <span>
                  <strong>{sessionLabel}</strong>
                </span>
              </button>
            </Tooltip>
          )
        })}
        {visibleSessions.length === 0 && !isRefreshing && (
          <p className='empty-sidebar'>No Pi sessions in this directory.</p>
        )}
      </nav>
      {otherSessions.length > 0 && (
        <section className='other-workspace-sessions'>
          <h2>Other workspaces</h2>
          <nav
            aria-label='Active and completed sessions in other workspaces'
            className='other-session-list'
          >
            {otherSessions.map((session) => {
              const indicator = sessionIndicator(
                session,
                selectedId,
                compactingSessionIds,
                completedSessionIds,
              )
              return (
                <Tooltip key={session.id} label={`${session.name}\n${session.cwd}`}>
                  <button
                    aria-label={`${session.name} in workspace ${session.cwd}`}
                    className={`session-item${indicator ? ` ${indicator}` : ''}`}
                    onClick={() => onSelectOtherWorkspaceSession(session)}
                    type='button'
                  >
                    {indicator && <SessionStatusIndicator status={indicator} />}
                    <span>
                      <strong>{session.name}</strong>
                      <small>{session.cwd}</small>
                    </span>
                  </button>
                </Tooltip>
              )
            })}
          </nav>
        </section>
      )}
    </aside>
  )
}

/** Prevents duplicate session creation and reports errors to the container. */
function NewSessionButton(
  { onCreate, onError }: { onCreate: () => Promise<void>; onError: (cause: unknown) => void },
) {
  const [busy, setBusy] = useState(false)

  async function create(): Promise<void> {
    setBusy(true)
    try {
      await onCreate()
    } catch (cause) {
      onError(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className='new-session'
      disabled={busy}
      onClick={() => void create()}
      type='button'
    >
      {busy ? 'Starting…' : '＋ New session'}
    </button>
  )
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.5'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' />
      <path d='m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.9 1.9 0 0 0-3.2 1.3v.2a2 2 0 1 1-4 0v-.2a1.9 1.9 0 0 0-3.2-1.3l.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.9 1.9 0 0 0 2.2 12a1.9 1.9 0 0 0 1.2-3.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.9 1.9 0 0 0 3.2-1.3v-.2a2 2 0 1 1 4 0v.2a1.9 1.9 0 0 0 3.2 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.9 1.9 0 0 0 20.8 12a1.9 1.9 0 0 0-1.4 3Z' />
    </svg>
  )
}
