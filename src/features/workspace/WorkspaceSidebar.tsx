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
import { shubCompactTokens } from '../../../shared/shub-agent-session.ts'
import { FileExplorer } from '../files/FileExplorer.tsx'
import { GitWidget } from '../git/GitWidget.tsx'
import type {
  GitFileDiff,
  GitProject,
  GitPushResult,
  GitResetResult,
  GitRevertResult,
  GitSnapshot,
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
import { formatSessionTime } from './session-time.ts'
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

type WorkspacePanel = 'sessions' | 'files' | 'git'

interface WorkspaceSidebarProps {
  archivedSessionPaths: readonly string[]
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
  onToggleSessionArchive: (target: SessionActionTarget) => void
  onError: (cause: unknown) => void
  onOpenFile: (path: string) => void
  workspaceGit: Record<string, GitSnapshot>
  onGitCommit: (message: string) => Promise<void>
  onGitDiscard: (path?: string) => Promise<void>
  onGitFileSelect: (path: string, commitHash?: string) => Promise<GitFileDiff>
  onGitPull: () => Promise<void>
  onGitPush: () => Promise<GitPushResult>
  onGitRefresh: () => Promise<void>
  onGitReset: (hash: string) => Promise<GitResetResult>
  onGitRevert: (hash: string) => Promise<GitRevertResult>
}

/** Displays the current workspace and opens or selects its recent Pi sessions. */
export function WorkspaceSidebar({
  archivedSessionPaths,
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
  onToggleSessionArchive,
  onError,
  onOpenFile,
  workspaceGit,
  onGitCommit,
  onGitDiscard,
  onGitFileSelect,
  onGitPull,
  onGitPush,
  onGitRefresh,
  onGitReset,
  onGitRevert,
}: WorkspaceSidebarProps) {
  const [openingSessionPath, setOpeningSessionPath] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState({ left: 0, top: 0 })
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceContextMenuState | null>(null)
  const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState({ left: 0, top: 0 })
  const [renameTarget, setRenameTarget] = useState<SessionActionTarget | null>(null)
  const [brandMenuOpen, setBrandMenuOpen] = useState(false)
  const [sessionListMenuOpen, setSessionListMenuOpen] = useState(false)
  const [showArchivedSessions, setShowArchivedSessions] = useState(false)
  const [includeShubAgentSessions, setIncludeShubAgentSessions] = useState(false)
  const [startingNewSession, setStartingNewSession] = useState(false)
  const [openWorkspacePanel, setOpenWorkspacePanel] = useState<WorkspacePanel>('sessions')
  const selectedSessionRef = useRef<HTMLButtonElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const workspaceMenuRef = useRef<HTMLDivElement>(null)
  const workspaceMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const brandMenuRef = useRef<HTMLDivElement>(null)
  const brandMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const sessionListMenuRef = useRef<HTMLDivElement>(null)
  const sessionListMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const archivedSessionPathSet = useMemo(
    () => new Set(archivedSessionPaths),
    [archivedSessionPaths],
  )
  const resolvedPinnedSessions = useMemo(
    () =>
      resolvePinnedSessions(pinnedSessions, recentSessions, sentSessions)
        .filter(({ sessionPath }) => !archivedSessionPathSet.has(sessionPath)),
    [archivedSessionPathSet, pinnedSessions, recentSessions, sentSessions],
  )
  const pinnedSessionPaths = useMemo(
    () => new Set(resolvedPinnedSessions.map(({ sessionPath }) => sessionPath)),
    [resolvedPinnedSessions],
  )
  const visibleSessions = useMemo(() => {
    const filtered = sidebarSessions(
      recentSessions,
      workspacePath,
      sentSessions,
      includeShubAgentSessions,
    )
      .filter(({ sessionPath }) => !pinnedSessionPaths.has(sessionPath))
      .filter(({ sessionPath }) => showArchivedSessions || !archivedSessionPathSet.has(sessionPath))
    if (!includeShubAgentSessions) return filtered

    const visibleOwnerIds = new Set(
      filtered.filter(({ shubAgent }) => shubAgent === undefined).map(({ id }) => id),
    )
    return filtered.filter(({ shubAgent, ownerSessionId }) =>
      shubAgent === undefined
      || (ownerSessionId !== undefined && visibleOwnerIds.has(ownerSessionId))
    )
  }, [
    archivedSessionPathSet,
    includeShubAgentSessions,
    pinnedSessionPaths,
    recentSessions,
    sentSessions,
    showArchivedSessions,
    workspacePath,
  ])
  const workspaces = useMemo(() => projectDetails?.workspaces ?? [], [projectDetails])
  const selectedWorkspace = workspaces.find(({ path }) => path === workspacePath)
  const selectedWorkspaceLabel = selectedWorkspace?.branch ?? workspacePath
  const mainWorkspace = workspaces.find(({ main }) => main)
  const worktrees = [...workspaces]
    .filter(({ main }) => !main)
    .sort((left, right) => compareWorkspaces(left, right, recentSessions, sentSessions))
  const currentBranch = selectedWorkspace?.branch
    ?? workspacePath.split(/[\\/]/).filter(Boolean).at(-1)
    ?? workspacePath
  const selectedGit = workspaceGit[workspacePath]
  const mainGit = mainWorkspace ? workspaceGit[mainWorkspace.path] : undefined
  const mainWorkspaceCurrent = mainWorkspace?.path === workspacePath
  const gitDirtyCount = selectedGit?.files.length ?? 0
  const gitUnpushedCount = selectedGit?.ahead ?? 0
  const gitChangeCount = gitDirtyCount + gitUnpushedCount
  const contextSessionPath = contextMenu?.target.sessionPath
  const contextSessionPinned = Boolean(
    contextSessionPath && pinnedSessionPaths.has(contextSessionPath),
  )
  const contextSessionCanPin = contextSessionPinned || Boolean(
    contextSessionPath
      && recentSessions.some(({ sessionPath }) => sessionPath === contextSessionPath),
  )
  const contextSessionArchived = Boolean(
    contextSessionPath && archivedSessionPathSet.has(contextSessionPath),
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
    if (!brandMenuOpen) return
    const dismissOnPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !brandMenuRef.current?.contains(event.target))
        setBrandMenuOpen(false)
    }
    const dismissOnKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setBrandMenuOpen(false)
      brandMenuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOnPointerDown)
    document.addEventListener('keydown', dismissOnKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown)
      document.removeEventListener('keydown', dismissOnKeyDown)
    }
  }, [brandMenuOpen])

  useEffect(() => {
    if (!sessionListMenuOpen) return
    const dismissOnPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !sessionListMenuRef.current?.contains(event.target))
        setSessionListMenuOpen(false)
    }
    const dismissOnKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setSessionListMenuOpen(false)
      sessionListMenuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOnPointerDown)
    document.addEventListener('keydown', dismissOnKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown)
      document.removeEventListener('keydown', dismissOnKeyDown)
    }
  }, [sessionListMenuOpen])

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
    setSessionListMenuOpen(false)
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
    setSessionListMenuOpen(false)
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

  function toggleContextArchive(): void {
    if (!contextMenu) return
    const { target } = contextMenu
    dismissContextMenu()
    onToggleSessionArchive(target)
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
      setIncludeShubAgentSessions(false)
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
        <Tooltip label={`${project.name} — ${workspacePath}`}>
          <button
            aria-label={`Expand session sidebar: ${project.name}, ${currentBranch}`}
            className='sidebar-context-chip'
            onClick={onToggleCollapsed}
            type='button'
          >
            <strong>{project.name}</strong>
            <span aria-hidden='true' className='sidebar-context-chip-sep'>▸</span>
            <span className='sidebar-context-chip-ws'>{currentBranch}</span>
            {selectedGit && selectedGit.files.length > 0 && (
              <i aria-hidden='true' className='sidebar-context-chip-dot' />
            )}
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
        <div className='brand-menu'>
          <Tooltip label='Projects overview'>
            <button
              aria-expanded={brandMenuOpen}
              aria-haspopup='menu'
              aria-label='Projects overview menu'
              className='brand-menu-trigger'
              onClick={() => setBrandMenuOpen((open) => !open)}
              ref={brandMenuTriggerRef}
              type='button'
            >
              <span aria-hidden='true' className='brand-mark'>π</span>
            </button>
          </Tooltip>
          {brandMenuOpen && (
            <div
              aria-label='Projects overview'
              className='brand-menu-list'
              ref={brandMenuRef}
              role='menu'
            >
              <a href='/' role='menuitem'>
                Back to projects overview
              </a>
            </div>
          )}
        </div>
        <div className='brand-project'>
          <strong title={project.name}>{project.name}</strong>
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
      {mainWorkspace && (
        <Tooltip label={`${mainWorkspace.branch ?? mainWorkspace.path} — ${mainWorkspace.path}`}>
          <button
            aria-current={mainWorkspaceCurrent ? 'page' : undefined}
            className={`workspace-card${mainWorkspaceCurrent ? ' current' : ''}`}
            onClick={() =>
              onSelectWorkspace(mainWorkspace.path)}
            type='button'
          >
            <span className='workspace-card-head'>
              <span aria-hidden='true' className='workspace-card-glyph'>⎇</span>
              <span className='workspace-card-branch'>{mainWorkspace.branch ?? 'main'}</span>
              <span className='workspace-card-pill'>Main</span>
            </span>
            <span className='workspace-card-path' title={mainWorkspace.path}>
              {mainWorkspace.path}
            </span>
            {mainGit && <GitLine snapshot={mainGit} />}
          </button>
        </Tooltip>
      )}
      <section className='project-list' aria-label={`${project.name} worktrees`}>
        <div className='project-item'>
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
          {worktrees.length > 0 && (
            <>
              <div className='sidebar-section-heading sidebar-list-heading'>
                <span>Worktrees</span>
                <Tooltip label='Refresh worktrees'>
                  <button
                    aria-label='Refresh worktrees'
                    className='new-session refresh-sessions'
                    onClick={onRefreshWorkspaces}
                    type='button'
                  >
                    <RefreshIcon />
                  </button>
                </Tooltip>
              </div>
              <div className='project-workspaces'>
                {worktrees.map((workspace) => {
                  const workspaceIndicator = aggregateSessionIndicator(
                    sessions.filter(({ cwd }) => cwd === workspace.path),
                    selectedId,
                    compactingSessionIds,
                    completedSessionIds,
                  )
                  const selected = workspace.path === workspacePath
                  return (
                    <div className='workspace-row' key={workspace.path}>
                      <button
                        aria-current={selected ? 'page' : undefined}
                        className={`workspace-path${selected ? ' selected' : ''}`}
                        onClick={() => onSelectWorkspace(workspace.path)}
                        type='button'
                      >
                        <span className='workspace-path-copy'>
                          <strong>{workspace.branch ?? workspace.path}</strong>
                          <span className='workspace-path-detail' title={workspace.path}>
                            {workspace.path}
                          </span>
                          {workspaceGit[workspace.path] && (
                            <GitLine snapshot={workspaceGit[workspace.path]} />
                          )}
                        </span>
                        {workspaceIndicator && (
                          <SessionStatusIndicator status={workspaceIndicator} />
                        )}
                      </button>
                      <Tooltip
                        label={`Workspace actions for ${workspace.branch ?? workspace.path}`}
                      >
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
            </>
          )}
        </div>
      </section>
      <div className='sidebar-section-heading sidebar-list-heading workspace-view-heading'>
        <div aria-label='Workspace view' className='workspace-view-tabs' role='tablist'>
          <button
            aria-controls='workspace-sessions-panel'
            aria-selected={openWorkspacePanel === 'sessions'}
            id='workspace-sessions-tab'
            onClick={() => setOpenWorkspacePanel('sessions')}
            role='tab'
            title={workspacePath}
            type='button'
          >
            Sessions
            {visibleSessions.length > 0 && <small>{visibleSessions.length}</small>}
          </button>
          <button
            aria-controls='workspace-files-panel'
            aria-selected={openWorkspacePanel === 'files'}
            id='workspace-files-tab'
            onClick={() => setOpenWorkspacePanel('files')}
            role='tab'
            type='button'
          >
            Files
          </button>
          <button
            aria-controls='workspace-git-panel'
            aria-selected={openWorkspacePanel === 'git'}
            id='workspace-git-tab'
            onClick={() => setOpenWorkspacePanel('git')}
            role='tab'
            title={gitChangeCount > 0
              ? `${gitDirtyCount} changed file${
                gitDirtyCount === 1 ? '' : 's'
              } · ${gitUnpushedCount} to push`
              : undefined}
            type='button'
          >
            Git
            {gitChangeCount > 0 && <small>{gitChangeCount}</small>}
          </button>
        </div>
        {openWorkspacePanel === 'sessions' && (
          <div className='sessions-heading-actions'>
            <Tooltip label='Session list options'>
              <button
                aria-expanded={sessionListMenuOpen}
                aria-haspopup='true'
                aria-label='Session list options'
                className='session-list-options'
                onClick={() => {
                  setContextMenu(null)
                  setWorkspaceMenu(null)
                  setSessionListMenuOpen((current) => !current)
                }}
                ref={sessionListMenuTriggerRef}
                type='button'
              >
                …
              </button>
            </Tooltip>
            {sessionListMenuOpen && (
              <div
                aria-label='Session list options'
                className='session-list-options-menu'
                ref={sessionListMenuRef}
              >
                <label>
                  <input
                    checked={showArchivedSessions}
                    type='checkbox'
                    onChange={(event) => setShowArchivedSessions(event.target.checked)}
                  />
                  Show archived items
                </label>
                <label>
                  <input
                    checked={includeShubAgentSessions}
                    type='checkbox'
                    onChange={(event) => setIncludeShubAgentSessions(event.target.checked)}
                  />
                  Include shub-agent sessions
                </label>
              </div>
            )}
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
        )}
      </div>
      {openWorkspacePanel === 'sessions' && (
        <section
          aria-labelledby='workspace-sessions-tab'
          className='workspace-view-panel'
          id='workspace-sessions-panel'
          role='tabpanel'
        >
          <nav
            aria-label={showArchivedSessions ? 'Pi sessions' : 'Recent Pi sessions'}
            className='session-list'
          >
            {isRefreshing && visibleSessions.length === 0 && (
              <p className='session-list-loading' role='status'>Loading sessions…</p>
            )}
            {visibleSessions.length > 0 && (
              <div aria-hidden='true' className='session-list-header'>
                <div className='session-list-header-labels'>
                  <span className='session-header-status' />
                  <span className='session-header-name'>Session</span>
                  <span className='session-header-first'>First</span>
                  <span className='session-header-last'>Last</span>
                </div>
                <span className='session-header-actions' />
              </div>
            )}
            {visibleSessions.map((recentSession) => {
              const shubChild = recentSession.shubAgent !== undefined
              const activeSession = sessions.find((session) =>
                session.sessionPath === recentSession.sessionPath && session.status !== 'exited'
              )
              const indicator = sessionIndicator(
                activeSession,
                selectedId,
                compactingSessionIds,
                completedSessionIds,
              )
              const archived = archivedSessionPathSet.has(recentSession.sessionPath)
              const sessionLabel = openingSessionPath === recentSession.sessionPath
                ? 'Opening…'
                : recentSession.name
              const firstMessageAt = recentSession.firstMessageAt
              const shubMeasurement = recentSession.shubTotalTokens !== undefined
                  && recentSession.shubOutputChars !== undefined
                ? `\nContext: ${shubCompactTokens(recentSession.shubTotalTokens)} in → ${
                  shubCompactTokens(Math.round(recentSession.shubOutputChars / 4))
                } out`
                : ''
              const tooltipLabel = `${recentSession.name}\nFirst: ${
                firstMessageAt === undefined
                  ? '—'
                  : new Date(firstMessageAt).toLocaleString('en-US')
              }\nLast: ${
                new Date(recentSession.updatedAt).toLocaleString('en-US')
              }${shubMeasurement}`
              const actionTarget: SessionActionTarget = {
                cwd: recentSession.cwd,
                name: recentSession.name,
                sessionId: activeSession?.id,
                sessionPath: recentSession.sessionPath,
              }
              return (
                <div
                  className={`session-row${shubChild ? ' shub-agent-session-row' : ''}`}
                  key={recentSession.sessionPath}
                >
                  <Tooltip label={tooltipLabel}>
                    <button
                      className={`session-item${
                        activeSession?.id === selectedId ? ' selected' : ''
                      }${archived ? ' archived' : ''}${indicator ? ` ${indicator}` : ''}`}
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
                      <span className='session-status-slot'>
                        {indicator
                          ? <SessionStatusIndicator status={indicator} />
                          : shubChild
                          ? <span aria-hidden='true' className='shub-agent-session-marker'>↳</span>
                          : archived
                          ? <ArchivedSessionIcon />
                          : null}
                      </span>
                      <span className='session-item-copy'>
                        <strong>{sessionLabel}</strong>
                      </span>
                      <span className='session-time session-time-first'>
                        {firstMessageAt === undefined ? '—' : formatSessionTime(firstMessageAt)}
                      </span>
                      <span className='session-time session-time-last'>
                        {formatSessionTime(recentSession.updatedAt)}
                      </span>
                    </button>
                  </Tooltip>
                  <SessionActions target={actionTarget} onOpen={openContextMenu} />
                </div>
              )
            })}
            {visibleSessions.length === 0 && !isRefreshing && (
              <p className='empty-sidebar'>
                {showArchivedSessions
                  ? 'No archived sessions in this directory.'
                  : 'No Pi sessions in this directory.'}
              </p>
            )}
          </nav>
        </section>
      )}
      {openWorkspacePanel === 'files' && (
        <section
          aria-labelledby='workspace-files-tab'
          className='workspace-view-panel'
          id='workspace-files-panel'
          role='tabpanel'
        >
          <FileExplorer key={workspacePath} onOpenFile={onOpenFile} workspacePath={workspacePath} />
        </section>
      )}
      {openWorkspacePanel === 'git' && (
        <section
          aria-labelledby='workspace-git-tab'
          className='workspace-view-panel'
          id='workspace-git-panel'
          role='tabpanel'
        >
          {selectedGit?.repository
            ? (
              <GitWidget
                onCommit={onGitCommit}
                onDiscard={onGitDiscard}
                onFileSelect={onGitFileSelect}
                onPull={onGitPull}
                onPush={onGitPush}
                onRefresh={onGitRefresh}
                onReset={onGitReset}
                onRevert={onGitRevert}
                snapshot={selectedGit}
              />
            )
            : <p className='empty-sidebar'>No Git repository in this workspace.</p>}
        </section>
      )}
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
          <button onClick={toggleContextArchive} role='menuitem' type='button'>
            {contextSessionArchived ? 'Restore from archive' : 'Archive session'}
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

/** Compact working-tree summary for the selected workspace; the sidebar card
    shows it while main is selected, the selected worktree row otherwise. */
function GitLine({ snapshot }: { snapshot: GitSnapshot }) {
  const clean = snapshot.files.length === 0
  return (
    <span className='git-line'>
      <i aria-hidden='true' className={`git-line-dot ${clean ? 'clean' : 'dirty'}`} />
      <span className={clean ? 'git-clean' : 'git-changed'}>
        {clean ? 'Clean' : `${snapshot.files.length} changed`}
      </span>
      {snapshot.ahead > 0 && <span className='git-ahead'>↑ {snapshot.ahead}</span>}
      {snapshot.worktree && snapshot.baseBranch && (
        <span className='git-divergence'>
          vs {snapshot.baseBranch}
          <b className='ahead'>+{snapshot.baseAhead}</b>
          <b className='behind'>−{snapshot.baseBehind}</b>
        </span>
      )}
    </span>
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

function ArchivedSessionIcon() {
  return (
    <svg
      aria-hidden='true'
      className='archived-session-icon'
      fill='none'
      height='14'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.6'
      viewBox='0 0 24 24'
      width='14'
    >
      <path d='M4 7h16v12H4z' />
      <path d='M3 4h18v3H3z' />
      <path d='M10 11h4' />
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
