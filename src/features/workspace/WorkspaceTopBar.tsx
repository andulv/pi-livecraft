import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import type {
  GitProject,
  GitSnapshot,
  GitWorkspace,
  SessionSummary,
} from '../../../shared/types.ts'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { Project } from './projects.ts'
import { aggregateSessionIndicator } from './session-indicator.ts'
import { SessionStatusIndicator } from './SessionStatusIndicator.tsx'
import { NewWorktreeDialog } from './NewWorktreeDialog.tsx'
import { WorktreeDeleteErrorDialog } from './WorktreeDeleteErrorDialog.tsx'
import { workspaceNavigation } from './workspace-navigation.ts'

interface WorkspaceTopBarProps {
  project: Project
  projectDetails?: GitProject
  workspacePath: string
  workspaceGit: Record<string, GitSnapshot>
  sessions: SessionSummary[]
  selectedId: string
  compactingSessionIds: ReadonlySet<string>
  completedSessionIds: ReadonlySet<string>
  collapsed: boolean
  onToggleCollapsed: () => void
  onRefreshWorkspaces: () => void
  onSelectWorkspace: (path: string) => void
  onOpenVSCode: (workspace: GitWorkspace) => void
  onDeleteWorktree: (workspace: GitWorkspace) => Promise<void>
  onCreateWorktree: (branch: string) => Promise<void>
}

type Popup = { kind: 'overflow' } | {
  kind: 'actions'
  workspace: GitWorkspace
  x: number
  y: number
}

/** Project-wide navigation stays visible independently of either sidebar. */
export function WorkspaceTopBar({
  project,
  projectDetails,
  workspacePath,
  workspaceGit,
  sessions,
  selectedId,
  compactingSessionIds,
  completedSessionIds,
  collapsed,
  onToggleCollapsed,
  onRefreshWorkspaces,
  onSelectWorkspace,
  onOpenVSCode,
  onDeleteWorktree,
  onCreateWorktree,
}: WorkspaceTopBarProps) {
  const navigationRef = useRef<HTMLElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const focusSelectedRef = useRef(false)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [popup, setPopup] = useState<Popup | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [newWorktreeOpen, setNewWorktreeOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<{ label: string; message: string } | null>(null)
  const { visible, overflow, cardWidth } = workspaceNavigation(
    projectDetails?.workspaces ?? [],
    workspacePath,
    availableWidth - (projectDetails?.workspaces.some(({ main }) => main) ? 36 : 0),
  )

  useLayoutEffect(() => {
    const element = navigationRef.current
    if (!element) return
    const measure = (): void => setAvailableWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (popup?.kind !== 'actions' || !popupRef.current) return
    const { width, height } = popupRef.current.getBoundingClientRect()
    setPosition({
      left: Math.min(Math.max(8, popup.x), Math.max(8, window.innerWidth - width - 8)),
      top: Math.min(Math.max(8, popup.y), Math.max(8, window.innerHeight - height - 8)),
    })
  }, [popup, deleteConfirm, availableWidth])

  useLayoutEffect(() => {
    setPopup(null)
    if (focusSelectedRef.current) {
      navigationRef.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus()
      focusSelectedRef.current = false
    }
  }, [workspacePath])

  useLayoutEffect(() => {
    if (popup?.kind === 'overflow') popupRef.current?.querySelector('button')?.focus()
  }, [popup])

  useEffect(() => {
    if (popup?.kind === 'overflow' && overflow.length === 0) {
      setPopup(null)
      triggerRef.current?.focus()
    }
  }, [popup, overflow.length])

  useEffect(() => {
    if (!popup) return
    const dismiss = (event: PointerEvent): void => {
      if (
        event.target instanceof Node
        && !popupRef.current?.contains(event.target)
        && !triggerRef.current?.contains(event.target)
      ) setPopup(null)
    }
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setPopup(null)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [popup])

  function openActions(workspace: GitWorkspace, event: MouseEvent<HTMLButtonElement>): void {
    // Opening actions replaces the overflow list, so its original trigger unmounts.
    triggerRef.current = popup?.kind === 'overflow'
      ? navigationRef.current?.querySelector<HTMLButtonElement>('.workspace-nav-more')
        ?? event.currentTarget
      : event.currentTarget
    setDeleteConfirm(false)
    const rect = event.currentTarget.getBoundingClientRect()
    setPopup({ kind: 'actions', workspace, x: rect.left, y: rect.bottom + 6 })
  }

  function dismissPopup(): void {
    setPopup(null)
    triggerRef.current?.focus()
  }

  function navigatePopup(event: KeyboardEvent<HTMLDivElement>): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    )
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End'
      ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault()
    buttons[next]?.focus()
  }

  function renderWorkspace(workspace: GitWorkspace) {
    const selected = workspace.path === workspacePath
    // Main and linked checkouts deliberately share the same status aggregation.
    const indicator = aggregateSessionIndicator(
      sessions.filter(({ cwd }) => cwd === workspace.path),
      selectedId,
      compactingSessionIds,
      completedSessionIds,
    )
    const snapshot = workspaceGit[workspace.path]
    return (
      <div className={`workspace-nav-card${selected ? ' selected' : ''}`} key={workspace.path}>
        <button
          aria-current={selected ? 'page' : undefined}
          aria-label={`${workspace.main ? 'Main checkout: ' : ''}${
            workspace.branch ?? workspace.path
          }`}
          className='workspace-nav-select'
          onClick={() => {
            focusSelectedRef.current = popup?.kind === 'overflow'
            setPopup(null)
            onSelectWorkspace(workspace.path)
          }}
          title={`${workspace.main ? 'Main checkout — ' : ''}${
            workspace.branch ?? 'Detached HEAD'
          } — ${workspace.path}`}
          type='button'
        >
          <span className='workspace-nav-head'>
            <strong>{workspace.branch ?? 'Detached HEAD'}</strong>
            {indicator && <SessionStatusIndicator status={indicator} />}
            {selected && <span aria-hidden='true' className='workspace-nav-check'>✓</span>}
          </span>
          <span
            className={`workspace-nav-path${workspace.main ? ' workspace-nav-main-label' : ''}`}
          >
            {workspace.main ? 'Main checkout' : workspace.path}
          </span>
          {snapshot && <GitLine snapshot={snapshot} />}
        </button>
        <Tooltip label={`Workspace actions for ${workspace.branch ?? workspace.path}`}>
          <button
            aria-haspopup='menu'
            aria-expanded={popup?.kind === 'actions' && popup.workspace.path === workspace.path}
            aria-label={`Workspace actions for ${workspace.branch ?? workspace.path}`}
            className='workspace-nav-actions'
            onClick={(event) => openActions(workspace, event)}
            type='button'
          >
            …
          </button>
        </Tooltip>
      </div>
    )
  }

  return (
    <header className='workspace-topbar' aria-label='Project and workspaces'>
      <Tooltip label={`${collapsed ? 'Expand' : 'Collapse'} session sidebar`}>
        <button
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} session sidebar`}
          className='workspace-sidebar-toggle'
          onClick={onToggleCollapsed}
          type='button'
        >
          <svg
            aria-hidden='true'
            fill='none'
            height='16'
            stroke='currentColor'
            strokeWidth='1.75'
            viewBox='0 0 24 24'
            width='16'
          >
            <rect x='3' y='4' width='18' height='16' rx='2' />
            <path d='M9 4v16' />
            <path d={collapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} />
          </svg>
        </button>
      </Tooltip>
      <a className='workspace-topbar-brand' href='/' title='Back to projects overview'>
        <span className='workspace-topbar-wordmark'>
          <span aria-hidden='true' className='brand-mark'>π</span>
          <strong>pi-livecraft</strong>
        </span>
        <span className='workspace-topbar-project' title={project.name}>{project.name}</span>
      </a>
      <nav
        aria-label='Workspaces'
        className='workspace-navigation'
        ref={navigationRef}
        style={{ '--workspace-card-width': `${cardWidth}px` } as CSSProperties}
      >
        {visible.map((workspace) => (
          <Fragment key={workspace.path}>
            {renderWorkspace(workspace)}
            {workspace.main && (
              <Tooltip label='Refresh workspaces'>
                <button
                  aria-label='Refresh workspaces'
                  className='workspace-nav-refresh'
                  onClick={onRefreshWorkspaces}
                  type='button'
                >
                  ↻
                </button>
              </Tooltip>
            )}
          </Fragment>
        ))}
        {overflow.length > 0 && (
          <button
            aria-expanded={popup?.kind === 'overflow'}
            aria-controls='workspace-overflow'
            className='workspace-nav-more'
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
              event.preventDefault()
              triggerRef.current = event.currentTarget
              setPopup({ kind: 'overflow' })
            }}
            onClick={(event) => {
              triggerRef.current = event.currentTarget
              setPopup(popup?.kind === 'overflow' ? null : { kind: 'overflow' })
            }}
            type='button'
          >
            More · {overflow.length} <span aria-hidden='true'>⌄</span>
          </button>
        )}
        {!projectDetails && <span className='workspace-nav-loading'>Loading workspaces…</span>}
        {popup?.kind === 'overflow' && (
          <div
            aria-label='More workspaces'
            className='workspace-overflow'
            id='workspace-overflow'
            onKeyDown={navigatePopup}
            ref={popupRef}
          >
            {overflow.map(renderWorkspace)}
          </div>
        )}
      </nav>
      {popup?.kind === 'actions' && (
        <div
          aria-label={`Workspace actions for ${popup.workspace.branch ?? popup.workspace.path}`}
          className='session-context-menu'
          onKeyDown={navigatePopup}
          ref={popupRef}
          role='menu'
          style={position}
        >
          <button
            autoFocus
            onClick={() => {
              onOpenVSCode(popup.workspace)
              dismissPopup()
            }}
            role='menuitem'
            type='button'
          >
            Open in VS Code
          </button>
          {popup.workspace.main
            ? (
              <button
                onClick={() => {
                  dismissPopup()
                  setNewWorktreeOpen(true)
                }}
                role='menuitem'
                type='button'
              >
                New worktree…
              </button>
            )
            : deleteConfirm
            ? (
              <>
                <button
                  className='session-context-menu-back'
                  onClick={() => setDeleteConfirm(false)}
                  role='menuitem'
                  type='button'
                >
                  ← Delete worktree
                </button>
                <button
                  className='danger'
                  onClick={() => {
                    const workspace = popup.workspace
                    dismissPopup()
                    void onDeleteWorktree(workspace).catch((cause: unknown) =>
                      setDeleteError({
                        label: workspace.branch ?? workspace.path,
                        message: cause instanceof Error ? cause.message : String(cause),
                      })
                    )
                  }}
                  role='menuitem'
                  type='button'
                >
                  Delete {popup.workspace.branch ?? 'worktree'}
                </button>
              </>
            )
            : (
              <button
                className='danger'
                onClick={() => setDeleteConfirm(true)}
                role='menuitem'
                type='button'
              >
                Delete worktree…
              </button>
            )}
        </div>
      )}
      {newWorktreeOpen && (
        <NewWorktreeDialog onClose={() => setNewWorktreeOpen(false)} onConfirm={onCreateWorktree} />
      )}
      {deleteError && (
        <WorktreeDeleteErrorDialog
          label={deleteError.label}
          message={deleteError.message}
          onClose={() => setDeleteError(null)}
        />
      )}
    </header>
  )
}

/** Each checkout retains its own Git summary, including linked-worktree divergence. */
function GitLine({ snapshot }: { snapshot: GitSnapshot }) {
  const clean = snapshot.files.length === 0
  const summary = `${clean ? 'Clean' : `${snapshot.files.length} changed`}${
    snapshot.ahead > 0 ? ` · ↑ ${snapshot.ahead}` : ''
  }${
    snapshot.worktree && snapshot.baseBranch
      ? ` · vs ${snapshot.baseBranch} +${snapshot.baseAhead} −${snapshot.baseBehind}`
      : ''
  }`
  return (
    <span className='workspace-nav-git' title={summary}>
      <i aria-hidden='true' className={clean ? 'clean' : 'dirty'} />
      <span>{summary}</span>
    </span>
  )
}
