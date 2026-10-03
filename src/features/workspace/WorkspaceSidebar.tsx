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
import { shubMeasurementLabel } from '../../../shared/shub-agent-session.ts'
import { FileExplorer } from '../files/FileExplorer.tsx'
import { GitWidget } from '../git/GitWidget.tsx'
import type {
  GitCommitFiles,
  GitFileDiff,
  GitOutgoingChanges,
  GitProject,
  GitPushResult,
  GitResetResult,
  GitRevertResult,
  GitSnapshot,
  RecentSession,
  SessionSummary,
} from '../../../shared/types.ts'
import { resolvePinnedSessions } from './pinned-sessions.ts'
import { PinnedSessionList } from './PinnedSessionList.tsx'
import type { Project } from './projects.ts'
import { sessionIndicator } from './session-indicator.ts'
import { SessionStatusIndicator } from './SessionStatusIndicator.tsx'
import { sidebarSessions, type SessionActionTarget } from './sidebar-sessions.ts'
import { SessionRenameDialog } from './SessionRenameDialog.tsx'
import { formatSessionTime } from './session-time.ts'
import { maxWorkspaceSidebarWidth, minWorkspaceSidebarWidth } from './workspace-sidebar.ts'
import type { RequestCause } from '../../api.ts'

interface ContextMenuState {
  target: SessionActionTarget
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
  onOpenSession: (session: RecentSession) => Promise<void>
  onSelectSession: (sessionId: string) => void
  onRenameSession: (target: SessionActionTarget, name: string) => Promise<void>
  onMoveSession: (target: SessionActionTarget, targetCwd: string) => Promise<void>
  onResize: (width: number) => void
  onToggleProjectPin: (target: SessionActionTarget) => void
  onToggleSessionArchive: (target: SessionActionTarget) => void
  onError: (cause: unknown) => void
  onOpenFile: (path: string) => void
  onPinFile: (path: string) => void
  onOpenGitDiff: (
    path: string,
    diff: string,
    before: string,
    beforeAvailable: boolean,
    after: string,
    afterAvailable: boolean,
    commitHash?: string,
    pin?: boolean,
  ) => void
  workspaceGit: Record<string, GitSnapshot>
  onGitCommit: (message: string) => Promise<void>
  onGitDiscard: (path?: string) => Promise<void>
  onGitFileSelect: (path: string, commitHash?: string) => Promise<GitFileDiff>
  onGitCommitFiles: (hash: string) => Promise<GitCommitFiles>
  onGitOutgoingChanges: () => Promise<GitOutgoingChanges>
  onGitOutgoingFileSelect: (path: string) => Promise<GitFileDiff>
  onGitPull: () => Promise<void>
  onGitPush: () => Promise<GitPushResult>
  onGitRefresh: (cause: RequestCause) => Promise<void>
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
  onOpenSession,
  onSelectSession,
  onRenameSession,
  onMoveSession,
  onResize,
  onToggleProjectPin,
  onToggleSessionArchive,
  onError,
  onOpenFile,
  onPinFile,
  onOpenGitDiff,
  workspaceGit,
  onGitCommit,
  onGitDiscard,
  onGitFileSelect,
  onGitCommitFiles,
  onGitOutgoingChanges,
  onGitOutgoingFileSelect,
  onGitPull,
  onGitPush,
  onGitRefresh,
  onGitReset,
  onGitRevert,
}: WorkspaceSidebarProps) {
  const [openingSessionPath, setOpeningSessionPath] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState({ left: 0, top: 0 })
  const [renameTarget, setRenameTarget] = useState<SessionActionTarget | null>(null)
  const [showMoveTargets, setShowMoveTargets] = useState(false)
  const [sessionListMenuOpen, setSessionListMenuOpen] = useState(false)
  const [showArchivedSessions, setShowArchivedSessions] = useState(false)
  const [includeShubAgentSessions, setIncludeShubAgentSessions] = useState(false)
  const [startingNewSession, setStartingNewSession] = useState(false)
  const [openWorkspacePanel, setOpenWorkspacePanel] = useState<WorkspacePanel>('sessions')
  const [filesWorkspace, setFilesWorkspace] = useState<string | null>(null)
  useEffect(() => {
    setFilesWorkspace((previous) =>
      openWorkspacePanel === 'files' ? workspacePath : previous === workspacePath ? previous : null
    )
  }, [openWorkspacePanel, workspacePath])
  const selectedSessionRef = useRef<HTMLButtonElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuTriggerRef = useRef<HTMLButtonElement>(null)
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
  const selectedGit = workspaceGit[workspacePath]
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
  const contextMoveTargets = contextMenu
    ? workspaces.filter((workspace) => workspace.path !== contextMenu.target.cwd)
    : []
  const contextCanMove = Boolean(contextSessionPath) && contextMoveTargets.length > 0

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

  function dismissContextMenu(): void {
    setContextMenu(null)
    setShowMoveTargets(false)
    contextMenuTriggerRef.current?.focus()
  }

  function openContextMenu(
    target: SessionActionTarget,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault()
    setSessionListMenuOpen(false)
    contextMenuTriggerRef.current = event.currentTarget
    setShowMoveTargets(false)
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

  function moveToWorktree(targetCwd: string): void {
    if (!contextMenu) return
    const { target } = contextMenu
    dismissContextMenu()
    void onMoveSession(target, targetCwd).catch(onError)
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
      {resolvedPinnedSessions.length > 0 && (
        <section className='project-list' aria-label={`${project.name} pinned sessions`}>
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
        </section>
      )}
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
                ? `\n${
                  shubMeasurementLabel(
                    recentSession.shubTotalTokens,
                    recentSession.shubOutputChars,
                    recentSession.shubContextTokens,
                  )
                }`
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
      {(openWorkspacePanel === 'files' || filesWorkspace === workspacePath) && (
        <section
          hidden={openWorkspacePanel !== 'files'}
          aria-labelledby='workspace-files-tab'
          className='workspace-view-panel'
          id='workspace-files-panel'
          role='tabpanel'
        >
          <FileExplorer
            key={workspacePath}
            onOpenFile={onOpenFile}
            onPinFile={onPinFile}
            workspacePath={workspacePath}
          />
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
                onCommitFiles={onGitCommitFiles}
                onOutgoingChanges={onGitOutgoingChanges}
                onOutgoingFileSelect={onGitOutgoingFileSelect}
                onOpenDiff={onOpenGitDiff}
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
      {contextMenu && (
        <div
          aria-label='Session actions'
          className='session-context-menu'
          ref={contextMenuRef}
          role='menu'
          style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
        >
          {showMoveTargets
            ? (
              <>
                <button
                  autoFocus
                  className='session-context-menu-back'
                  onClick={() => setShowMoveTargets(false)}
                  role='menuitem'
                  type='button'
                >
                  ← Move to worktree
                </button>
                {contextMoveTargets.map((workspace) => (
                  <button
                    key={workspace.path}
                    onClick={() => moveToWorktree(workspace.path)}
                    role='menuitem'
                    type='button'
                  >
                    {workspace.branch ?? workspace.path.split(/[\\/]/).filter(Boolean).at(-1)
                      ?? workspace.path}
                    {workspace.main && <span className='session-context-menu-tag'>main</span>}
                  </button>
                ))}
              </>
            )
            : (
              <>
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
                {contextCanMove && (
                  <button
                    onClick={() => setShowMoveTargets(true)}
                    role='menuitem'
                    type='button'
                  >
                    Move to worktree…
                  </button>
                )}
                <button onClick={toggleContextArchive} role='menuitem' type='button'>
                  {contextSessionArchived ? 'Restore from archive' : 'Archive session'}
                </button>
              </>
            )}
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
