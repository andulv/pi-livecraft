import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type {
  GitProject,
  GitWorkspace,
  RecentSession,
  SessionSummary,
} from '../../../shared/types.ts'
import { resolvePinnedSessions } from './pinned-sessions.ts'
import { PinnedSessionList } from './PinnedSessionList.tsx'
import type { Project } from './projects.ts'
import { aggregateSessionIndicator, sessionIndicator } from './session-indicator.ts'
import { SessionStatusIndicator } from './SessionStatusIndicator.tsx'
import { compareWorkspaces, sidebarSessions, type SessionActionTarget } from './sidebar-sessions.ts'
import { SessionRenameDialog } from './SessionRenameDialog.tsx'
import { maxWorkspaceSidebarWidth, minWorkspaceSidebarWidth } from './workspace-sidebar.ts'

interface ContextMenuState {
  target: SessionActionTarget
  x: number
  y: number
}

interface WorkspaceContextMenuState {
  workspace: GitWorkspace
  x: number
  y: number
}

interface WorkspaceSidebarProps {
  collapsed: boolean
  compactingSessionIds: ReadonlySet<string>
  completedSessionIds: ReadonlySet<string>
  isRefreshing: boolean
  pinnedSessions: RecentSession[]
  recentSessions: RecentSession[]
  sentSessions: RecentSession[]
  sessions: SessionSummary[]
  selectedId: string
  width: number
  workspacePath: string
  project: Project
  projectDetails?: GitProject
  onOpenHome: () => void
  onOpenPinnedSession: (session: RecentSession) => Promise<void>
  onNewSession: () => Promise<void>
  onRefreshSessions: () => void
  onRefreshWorkspaces: () => void
  onOpenSession: (session: RecentSession) => Promise<void>
  onOpenVSCode: (workspace: GitWorkspace) => void
  onSelectWorkspace: (path: string) => void
  onSelectSession: (sessionId: string) => void
  onOpenSettings: () => void
  onRenameSession: (target: SessionActionTarget, name: string) => Promise<void>
  onResize: (width: number) => void
  onToggleCollapsed: () => void
  onToggleProjectPin: (target: SessionActionTarget) => void
  onError: (cause: unknown) => void
}

/** Displays the current workspace and opens or selects its recent Pi sessions. */
export function WorkspaceSidebar({
  collapsed,
  compactingSessionIds,
  completedSessionIds,
  isRefreshing,
  pinnedSessions,
  recentSessions,
  sentSessions,
  sessions,
  selectedId,
  width,
  workspacePath,
  project,
  projectDetails,
  onOpenHome,
  onOpenPinnedSession,
  onNewSession,
  onRefreshSessions,
  onRefreshWorkspaces,
  onOpenSession,
  onOpenVSCode,
  onSelectWorkspace,
  onSelectSession,
  onOpenSettings,
  onRenameSession,
  onResize,
  onToggleCollapsed,
  onToggleProjectPin,
  onError,
}: WorkspaceSidebarProps) {
  const [openingSessionPath, setOpeningSessionPath] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState({ left: 0, top: 0 })
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceContextMenuState | null>(null)
  const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState({ left: 0, top: 0 })
  const [renameTarget, setRenameTarget] = useState<SessionActionTarget | null>(null)
  const [startingNewSession, setStartingNewSession] = useState(false)
  const selectedSessionRef = useRef<HTMLButtonElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const workspaceMenuRef = useRef<HTMLDivElement>(null)
  const workspaceMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const resolvedPinnedSessions = useMemo(
    () => resolvePinnedSessions(pinnedSessions, recentSessions, sentSessions),
    [pinnedSessions, recentSessions, sentSessions],
  )
  const pinnedSessionPaths = useMemo(
    () => new Set(resolvedPinnedSessions.map(({ sessionPath }) => sessionPath)),
    [resolvedPinnedSessions],
  )
  const visibleSessions = useMemo(
    () =>
      sidebarSessions(recentSessions, workspacePath, sentSessions)
        .filter(({ sessionPath }) => !pinnedSessionPaths.has(sessionPath)),
    [pinnedSessionPaths, recentSessions, sentSessions, workspacePath],
  )
  const workspaces = useMemo(() => projectDetails?.workspaces ?? [], [projectDetails])
  const selectedWorkspace = workspaces.find(({ path }) => path === workspacePath)
  const selectedWorkspaceLabel = selectedWorkspace?.branch ?? workspacePath
  const projectIndicator = aggregateSessionIndicator(
    sessions.filter(({ cwd }) => workspaces.some(({ path }) => path === cwd)),
    selectedId,
    compactingSessionIds,
    completedSessionIds,
  )
  const contextSessionPath = contextMenu?.target.sessionPath
  const contextSessionPinned = Boolean(
    contextSessionPath && pinnedSessionPaths.has(contextSessionPath),
  )
  const contextSessionCanPin = contextSessionPinned || Boolean(
    contextSessionPath
      && recentSessions.some(({ sessionPath }) => sessionPath === contextSessionPath),
  )

  useEffect(() => {
    selectedSessionRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, visibleSessions])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const { width: menuWidth, height: menuHeight } = contextMenuRef.current.getBoundingClientRect()
    const left = Math.min(
      Math.max(8, contextMenu.x),
      Math.max(8, window.innerWidth - menuWidth - 8),
    )
    const top = Math.min(
      Math.max(8, contextMenu.y),
      Math.max(8, window.innerHeight - menuHeight - 8),
    )
    setContextMenuPosition({ left, top })
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const dismissOnPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !contextMenuRef.current?.contains(event.target)) {
        setContextMenu(null)
      }
    }
    const dismissOnKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setContextMenu(null)
      contextMenuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOnPointerDown)
    document.addEventListener('keydown', dismissOnKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown)
      document.removeEventListener('keydown', dismissOnKeyDown)
    }
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!workspaceMenu || !workspaceMenuRef.current) return
    const { width: menuWidth, height: menuHeight } = workspaceMenuRef
      .current
      .getBoundingClientRect()
    setWorkspaceMenuPosition({
      left: Math.min(Math.max(8, workspaceMenu.x), Math.max(8, window.innerWidth - menuWidth - 8)),
      top: Math.min(Math.max(8, workspaceMenu.y), Math.max(8, window.innerHeight - menuHeight - 8)),
    })
  }, [workspaceMenu])

  useEffect(() => {
    if (!workspaceMenu) return
    const dismissOnPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !workspaceMenuRef.current?.contains(event.target))
        setWorkspaceMenu(null)
    }
    const dismissOnKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setWorkspaceMenu(null)
      workspaceMenuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOnPointerDown)
    document.addEventListener('keydown', dismissOnKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown)
      document.removeEventListener('keydown', dismissOnKeyDown)
    }
  }, [workspaceMenu])

  function dismissContextMenu(): void {
    setContextMenu(null)
    contextMenuTriggerRef.current?.focus()
  }

  function openWorkspaceMenu(
    workspace: GitWorkspace,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault()
    setContextMenu(null)
    workspaceMenuTriggerRef.current = event.currentTarget
    setWorkspaceMenu({ workspace, x: event.clientX, y: event.clientY })
  }

  function openWorkspaceVSCode(): void {
    if (!workspaceMenu) return
    const { workspace } = workspaceMenu
    setWorkspaceMenu(null)
    onOpenVSCode(workspace)
  }

  function openContextMenu(
    target: SessionActionTarget,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault()
    setWorkspaceMenu(null)
    contextMenuTriggerRef.current = event.currentTarget
    setContextMenu({ target, x: event.clientX, y: event.clientY })
  }

  function startRename(): void {
    if (!contextMenu) return
    const { target } = contextMenu
    dismissContextMenu()
    setRenameTarget(target)
  }

  function toggleContextPin(): void {
    if (!contextMenu || !contextSessionCanPin) return
    const { target } = contextMenu
    dismissContextMenu()
    onToggleProjectPin(target)
  }

  function dismissRename(): void {
    setRenameTarget(null)
    contextMenuTriggerRef.current?.focus()
  }

  async function startNewSession(): Promise<void> {
    if (startingNewSession) return
    setStartingNewSession(true)
    try {
      await onNewSession()
    } catch (cause) {
      onError(cause)
    } finally {
      setStartingNewSession(false)
    }
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const handle = event.currentTarget
    const initialX = event.clientX
    const initialWidth = width
    handle.setPointerCapture(event.pointerId)

    const resize = (moveEvent: PointerEvent): void =>
      onResize(initialWidth + moveEvent.clientX - initialX)
    const stop = (): void => {
      handle.removeEventListener('pointermove', resize)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      handle.removeEventListener('lostpointercapture', stop)
    }

    handle.addEventListener('pointermove', resize)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
    handle.addEventListener('lostpointercapture', stop)
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const adjustment = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
    if (adjustment) {
      event.preventDefault()
      onResize(width + adjustment)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onResize(minWorkspaceSidebarWidth)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onResize(maxWorkspaceSidebarWidth)
    }
  }

  return (
    <aside
      aria-label='Session sidebar'
      className={`sidebar${collapsed ? ' collapsed' : ''}`}
    >
      <div className='sidebar-rail'>
        <Tooltip label='Expand session sidebar'>
          <button
            aria-expanded={false}
            aria-label='Expand session sidebar'
            className='sidebar-toggle'
            onClick={onToggleCollapsed}
            type='button'
          >
            <SidebarToggleIcon collapsed />
          </button>
        </Tooltip>
      </div>
      <div
        aria-label='Resize session sidebar'
        aria-orientation='vertical'
        aria-valuemax={maxWorkspaceSidebarWidth}
        aria-valuemin={minWorkspaceSidebarWidth}
        aria-valuenow={width}
        className='sidebar-resize-handle'
        onKeyDown={resizeWithKeyboard}
        onPointerDown={startResize}
        role='separator'
        tabIndex={0}
      />
      <div className='brand'>
        <span className='brand-mark'>π</span>
        <div>
          <strong>Pi Livecraft</strong>
          <small>Local workspace</small>
        </div>
        <Tooltip label='Settings'>
          <button
            aria-label='Open settings'
            className='settings-button'
            onClick={onOpenSettings}
            type='button'
          >
            <SettingsIcon />
          </button>
        </Tooltip>
        <Tooltip label='Collapse session sidebar'>
          <button
            aria-expanded={true}
            aria-label='Collapse session sidebar'
            className='sidebar-toggle'
            onClick={onToggleCollapsed}
            type='button'
          >
            <SidebarToggleIcon collapsed={false} />
          </button>
        </Tooltip>
      </div>
      <section className='project-list' aria-label={`${project.name} workspaces`}>
        <div className='sidebar-section-heading'>
          <button className='project-home-link' onClick={onOpenHome} type='button'>
            ← Projects
          </button>
        </div>
        <div className='project-item'>
          <div className='project-heading'>
            <strong>{project.name}</strong>
            {projectIndicator && <SessionStatusIndicator status={projectIndicator} />}
          </div>
          {resolvedPinnedSessions.length > 0 && (
            <PinnedSessionList
              compactingSessionIds={compactingSessionIds}
              completedSessionIds={completedSessionIds}
              onError={onError}
              onOpenActions={openContextMenu}
              onOpenSession={onOpenPinnedSession}
              pinnedSessions={resolvedPinnedSessions}
              selectedId={selectedId}
              sessions={sessions}
            />
          )}
          <div className='sidebar-section-heading sidebar-list-heading'>
            <span>Workspaces</span>
            <Tooltip label='Refresh workspaces'>
              <button
                aria-label='Refresh workspaces'
                className='new-session refresh-sessions'
                onClick={onRefreshWorkspaces}
                type='button'
              >
                <RefreshIcon />
              </button>
            </Tooltip>
          </div>
          <div className='project-workspaces'>
            {[...workspaces]
              .sort((left, right) => compareWorkspaces(left, right, recentSessions, sentSessions))
              .map((workspace) => {
                const workspaceIndicator = aggregateSessionIndicator(
                  sessions.filter(({ cwd }) => cwd === workspace.path),
                  selectedId,
                  compactingSessionIds,
                  completedSessionIds,
                )
                return (
                  <div className='workspace-row' key={workspace.path}>
                    <button
                      aria-current={workspace.path === workspacePath ? 'page' : undefined}
                      className={`workspace-path${
                        workspace.path === workspacePath ? ' selected' : ''
                      }`}
                      onClick={() => onSelectWorkspace(workspace.path)}
                      type='button'
                    >
                      <div className='workspace-path-copy'>
                        <span>{workspace.main ? 'Main workspace' : 'Worktree'}</span>
                        <strong>{workspace.branch ?? workspace.path}</strong>
                      </div>
                      {workspaceIndicator && <SessionStatusIndicator status={workspaceIndicator} />}
                    </button>
                    <Tooltip label={`Workspace actions for ${workspace.branch ?? workspace.path}`}>
                      <button
                        aria-haspopup='menu'
                        aria-label={`Workspace actions for ${workspace.branch ?? workspace.path}`}
                        className='session-actions workspace-actions'
                        onClick={(event) => openWorkspaceMenu(workspace, event)}
                        type='button'
                      >
                        …
                      </button>
                    </Tooltip>
                  </div>
                )
              })}
          </div>
        </div>
      </section>
      <div className='sidebar-section-heading sidebar-list-heading sessions-heading'>
        <span title={workspacePath}>
          Sessions – <b>{selectedWorkspaceLabel}</b>
        </span>
        <Tooltip label='Refresh sessions'>
          <button
            aria-label={`Refresh sessions in ${selectedWorkspaceLabel}`}
            className='new-session refresh-sessions'
            disabled={isRefreshing}
            onClick={onRefreshSessions}
            type='button'
          >
            <RefreshIcon />
          </button>
        </Tooltip>
        <Tooltip label='New session'>
          <button
            aria-label={`New session in ${selectedWorkspaceLabel}`}
            className='new-session'
            disabled={startingNewSession}
            onClick={() => void startNewSession()}
            type='button'
          >
            ＋
          </button>
        </Tooltip>
      </div>
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
          const actionTarget: SessionActionTarget = {
            cwd: recentSession.cwd,
            name: recentSession.name,
            sessionId: activeSession?.id,
            sessionPath: recentSession.sessionPath,
          }
          return (
            <div className='session-row' key={recentSession.sessionPath}>
              <Tooltip
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
                  <span className='session-item-copy'>
                    <strong>{sessionLabel}</strong>
                  </span>
                </button>
              </Tooltip>
              <SessionActions target={actionTarget} onOpen={openContextMenu} />
            </div>
          )
        })}
        {visibleSessions.length === 0 && !isRefreshing && (
          <p className='empty-sidebar'>No Pi sessions in this directory.</p>
        )}
      </nav>
      {workspaceMenu && (
        <div
          aria-label={`Workspace actions for ${
            workspaceMenu.workspace.branch ?? workspaceMenu.workspace.path
          }`}
          className='session-context-menu'
          ref={workspaceMenuRef}
          role='menu'
          style={{ left: workspaceMenuPosition.left, top: workspaceMenuPosition.top }}
        >
          <button autoFocus onClick={openWorkspaceVSCode} role='menuitem' type='button'>
            Open in VS Code
          </button>
        </div>
      )}
      {contextMenu && (
        <div
          aria-label='Session actions'
          className='session-context-menu'
          ref={contextMenuRef}
          role='menu'
          style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
        >
          <button
            autoFocus
            disabled={!contextSessionCanPin}
            onClick={toggleContextPin}
            role='menuitem'
            type='button'
          >
            {contextSessionPinned ? 'Unpin from project' : 'Pin to project'}
          </button>
          <button onClick={startRename} role='menuitem' type='button'>
            Rename…
          </button>
        </div>
      )}
      {renameTarget && (
        <SessionRenameDialog
          initialName={renameTarget.name}
          key={renameTarget.sessionPath ?? renameTarget.sessionId ?? renameTarget.name}
          onClose={dismissRename}
          onConfirm={(name) => onRenameSession(renameTarget, name)}
        />
      )}
    </aside>
  )
}

/** Opens the extensible action menu without competing with the session selection target. */
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

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.75'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M3 3v18' />
      <path d={collapsed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='15'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='2'
      viewBox='0 0 24 24'
      width='15'
    >
      <path d='M21 12a9 9 0 1 1-2.6-6.4' />
      <path d='M21 3v5h-5' />
    </svg>
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
