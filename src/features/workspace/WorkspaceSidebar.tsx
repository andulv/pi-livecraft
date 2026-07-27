import { useEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { RecentSession, SessionSummary } from '../../../shared/types.ts'
import { sessionIndicator, type SessionIndicator } from './session-indicator.ts'
import { sidebarSessions } from './sidebar-sessions.ts'

interface WorkspaceSidebarProps {
  compactingSessionIds: ReadonlySet<string>
  completedSessionIds: ReadonlySet<string>
  recentSessions: RecentSession[]
  sentSessions: RecentSession[]
  sessions: SessionSummary[]
  selectedId: string
  workspacePath: string
  onChooseWorkspace: () => void
  onCreate: () => Promise<void>
  onOpenSession: (session: RecentSession) => Promise<void>
  onSelectSession: (sessionId: string) => void
  onOpenSettings: () => void
  onError: (cause: unknown) => void
}

/** Displays the current workspace and opens or selects its recent Pi sessions. */
export function WorkspaceSidebar({ compactingSessionIds, completedSessionIds, recentSessions, sentSessions, sessions, selectedId, workspacePath, onChooseWorkspace, onCreate, onOpenSession, onSelectSession, onOpenSettings, onError }: WorkspaceSidebarProps) {
  const [openingSessionPath, setOpeningSessionPath] = useState('')
  const selectedSessionRef = useRef<HTMLButtonElement>(null)
  const visibleSessions = useMemo(() => sidebarSessions(recentSessions, workspacePath, sentSessions), [recentSessions, sentSessions, workspacePath])

  useEffect(() => {
    selectedSessionRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, visibleSessions])

  return <aside className="sidebar">
    <div className="brand">
      <span className="brand-mark">π</span>
      <div><strong>Pi Livecraft</strong><small>Local workspace</small></div>
      <Tooltip label="Settings"><button aria-label="Open settings" className="theme-toggle" onClick={onOpenSettings} type="button">
        <SettingsIcon />
      </button></Tooltip>
    </div>
    <div className="workspace-group">
      <Tooltip label={workspacePath}><button className="workspace-path" onClick={onChooseWorkspace} type="button">
        <span>Current directory</span><strong>{workspacePath}</strong>
      </button></Tooltip>
    </div>
    <NewSessionButton onCreate={onCreate} onError={onError} />
    <nav className="session-list" aria-label="Recent Pi sessions">
      {visibleSessions.map((recentSession) => {
        const activeSession = sessions.find((session) => session.sessionPath === recentSession.sessionPath && session.status !== 'exited')
        const indicator = sessionIndicator(activeSession, selectedId, compactingSessionIds, completedSessionIds)
        const sessionLabel = openingSessionPath === recentSession.sessionPath ? 'Opening…' : recentSession.name
        return (
          <Tooltip key={recentSession.sessionPath} label={`${recentSession.name}\n${new Date(recentSession.updatedAt).toLocaleString('en-US')}`}><button
            className={`session-item${activeSession?.id === selectedId ? ' selected' : ''}${indicator ? ` ${indicator}` : ''}`}
            disabled={openingSessionPath === recentSession.sessionPath}
            onClick={() => {
              if (activeSession) {
                onSelectSession(activeSession.id)
                return
              }
              setOpeningSessionPath(recentSession.sessionPath)
              void onOpenSession(recentSession).catch(onError).finally(() => setOpeningSessionPath(''))
            }}
            ref={activeSession?.id === selectedId ? selectedSessionRef : undefined}
            type="button"
          >
            {indicator && <SessionStatusIndicator status={indicator} />}
            <span><strong data-text={sessionLabel}>{sessionLabel}</strong></span>
          </button></Tooltip>
        )
      })}
      {visibleSessions.length === 0 && <p className="empty-sidebar">No Pi sessions in this directory.</p>}
    </nav>
  </aside>
}

const indicatorLabels: Record<SessionIndicator, string> = {
  working: 'Pi is working',
  waiting: 'Pi is waiting for your response',
  compacting: 'Pi is compacting the session',
  complete: 'Pi finished its turn',
}

/** Uses one visual vocabulary for active, attention, and completed session states. */
function SessionStatusIndicator({ status }: { status: SessionIndicator }) {
  return <Tooltip label={indicatorLabels[status]}><span aria-label={indicatorLabels[status]} className={`session-status-indicator ${status}`} role="img">
    {status === 'compacting' && <svg aria-hidden="true" viewBox="0 0 16 16"><line x1="13" y1="8" x2="6" y2="8" /><polyline points="13,8 10,6" /><polyline points="13,8 10,10" /><line x1="3" y1="8" x2="10" y2="8" /><polyline points="3,8 6,6" /><polyline points="3,8 6,10" /></svg>}
  </span></Tooltip>
}

/** Prevents duplicate session creation and reports errors to the container. */
function NewSessionButton({ onCreate, onError }: { onCreate: () => Promise<void>; onError: (cause: unknown) => void }) {
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

  return <button className="new-session" disabled={busy} onClick={() => void create()} type="button">{busy ? 'Starting…' : '＋ New session'}</button>
}

function SettingsIcon() {
  return <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="16"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.9 1.9 0 0 0-3.2 1.3v.2a2 2 0 1 1-4 0v-.2a1.9 1.9 0 0 0-3.2-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.9 1.9 0 0 0 2.2 12a1.9 1.9 0 0 0 1.2-3.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.9 1.9 0 0 0 3.2-1.3v-.2a2 2 0 1 1 4 0v.2a1.9 1.9 0 0 0 3.2 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.9 1.9 0 0 0 20.8 12a1.9 1.9 0 0 0-1.4 3Z" /></svg>
}
