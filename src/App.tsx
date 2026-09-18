import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import {
  commitChanges,
  createSession,
  discardChanges,
  getGitFileDiff,
  getGitSnapshot,
  getEnvironment,
  getExtensionSettings,
  getPiSettings,
  getQuotas,
  improvePrompt,
  openExplorer,
  openSession,
  openTerminal,
  openVSCode,
  pullCommits,
  pushCommits,
  refreshEnvironment,
  refreshQuotas,
  resetQuota,
  resetGitCommit,
  restartManager,
  revertGitCommit,
  savePrompt,
  sendPiCommand,
  subscribeManagerEvents,
  updateExtensionSetting,
  updatePiSetting,
  savePiSettingsDocument,
} from './api.ts'
import type { QuotaResetTarget } from './api.ts'
import type {
  ExtensionSettingsSnapshot,
  ExtensionSettingValue,
} from '../shared/extension-settings.ts'
import type { PiSettingsScope, PiSettingsSnapshot, PiSettingValue } from '../shared/pi-settings.ts'
import { quotaRefreshAllowed } from '../shared/quota-refresh.ts'
import type {
  GitSnapshot,
  JsonObject,
  ManagerRuntimeStatus,
  QuotaSnapshot,
  SessionEnvironmentSnapshot,
  SessionSummary,
} from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'
import { ChatTopBar } from './features/composer/status-bar/ChatTopBar.tsx'
import { Composer } from './features/composer/Composer.tsx'
import { ToastStack, type Toast } from './features/notifications/ToastStack.tsx'
import { sessionActivity, type PiConnection } from './features/conversation/activity.ts'
import { Conversation } from './features/conversation/Conversation.tsx'
import { useConversationRuntime } from './features/conversation/useConversationRuntime.ts'
import { useClientErrorLog } from './features/diagnostics/useClientErrorLog.ts'
import { AskUserQuestionDialog, ExtensionDialog } from './features/dialogs/Dialogs.tsx'
import {
  isAgentSelector,
  isAskUserQuestionDialog,
  isBlockingDialog,
  pendingDialogForSession,
  type UiDialog,
  visibleDialogForSession,
} from './features/dialogs/dialog-protocol.ts'
import {
  clampRightSidebarWidth,
  readActiveRightWidget,
  readRightSidebarWidth,
  type RightWidget,
} from './features/right-sidebar/right-sidebar.ts'
import { RightSidebar } from './features/right-sidebar/RightSidebar.tsx'
import { quotaProviderForModel } from './features/quotas/quota-display.ts'
import { ProjectHome } from './features/workspace/ProjectHome.tsx'
import {
  projectIdFromLocation,
  projectPageUrl,
  projectUrlState,
} from './features/workspace/project-url.ts'
import { projectFaviconHref, projectPageTitle } from './features/workspace/project-tab.ts'
import { worktreeColor } from './features/workspace/project-definition.ts'
import type { Project } from './features/workspace/projects.ts'
import { useProjects } from './features/workspace/useProjects.ts'
import { shubAgentMarker, sidebarSessions } from './features/workspace/sidebar-sessions.ts'
import { useWorkspaceSessions } from './features/workspace/useWorkspaceSessions.ts'
import { WorkspaceSidebar } from './features/workspace/WorkspaceSidebar.tsx'
import { FileContentPane } from './features/files/FileContentPane.tsx'
import { clampFilePaneShare, readFilePaneShare } from './features/files/file-pane-width.ts'
import {
  primaryBrowserId,
  readBrowserUrl,
  writeBrowserUrl,
} from './features/browser/browser-url.ts'
import { useWorkspaceViewerState } from './features/workspace/useWorkspaceViewerState.ts'
import {
  clampWorkspaceSidebarWidth,
  readWorkspaceSidebarCollapsed,
  readWorkspaceSidebarWidth,
} from './features/workspace/workspace-sidebar.ts'
import { CommandPalette, type PaletteCommand } from './features/commands/CommandPalette.tsx'
import {
  commandDefinitions,
  defaultShortcuts,
  lastAssistantText,
  migrateLegacyShortcut,
  rightWidgetFromCommand,
  shubReadOnlyCommands,
  shortcutFromEvent,
  type CommandId,
} from './features/commands/command-registry.ts'
import { SettingsPanel } from './features/settings/SettingsPanel.tsx'
import { ManagerRuntimeNotice } from './features/manager/ManagerRuntimeNotice.tsx'
import {
  allThemes,
  applyThemePalette,
  deleteTheme,
  duplicateTheme,
  persistThemePreferences,
  readThemePreferences,
  renameTheme,
  resetTheme,
  resolveActiveTheme,
  setActiveTheme,
  shadowForMode,
  updateThemeColor,
  type ThemeVariable,
} from './features/settings/themes.ts'
import { analyzeSession } from './features/session-analysis/session-analysis.ts'
import type { ConversationNavigationTarget } from './features/conversation/conversation-navigation.ts'
import './features/commands/commands.css'

const emptyAgentOptions: string[] = []
type ConversationView = 'simple' | 'semi-detailed' | 'detailed'

function nextConversationView(current: ConversationView): ConversationView {
  if (current === 'simple') return 'semi-detailed'
  if (current === 'semi-detailed') return 'detailed'
  return 'simple'
}

const gitRefreshDelayMs = 250
const managerUnavailableMessage = 'Pi manager is unavailable'
const managerUnavailableToastDelayMs = 1_000

/** Routes between the project registry and one URL-addressable Livecraft project. */
function App() {
  useClientErrorLog()
  const [projectId, setProjectId] = useState(() =>
    projectIdFromLocation(window.location.pathname, window.location.search)
  )
  const {
    addProject,
    isDiscovering,
    projectActivity,
    projectDetails,
    projects,
    refreshProjects,
    removeProject,
    unavailableProjectIds,
  } = useProjects()
  const project = projects.find((candidate) => candidate.id === projectId)

  useEffect(() => {
    document.title = projectPageTitle(project?.name)
    const favicon = document.querySelector<HTMLLinkElement>('#app-favicon')
    if (favicon) favicon.href = projectFaviconHref(project?.color)
  }, [project?.color, project?.name])

  useEffect(() => {
    const onPopState = (): void =>
      setProjectId(projectIdFromLocation(window.location.pathname, window.location.search))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Migrate the legacy `?project=` form to the path form on next load.
  useEffect(() => {
    if (window.location.pathname !== '/') return
    const params = new URLSearchParams(window.location.search)
    const legacy = params.get('project')
    if (!legacy) return
    params.delete('project')
    const query = params.toString()
    const url = `/project/${encodeURIComponent(legacy)}${query ? `?${query}` : ''}`
    window.history.replaceState({}, '', url)
    setProjectId(projectIdFromLocation(window.location.pathname, window.location.search))
  }, [])

  useEffect(() => {
    void refreshProjects()
  }, [projectId, refreshProjects])

  // A `/project/<id>` for an unknown id falls back to the frontpage.
  useEffect(() => {
    if (projectId && !project) {
      window.history.replaceState({}, '', '/')
      setProjectId(null)
    }
  }, [project, projectId])

  const navigate = useCallback((nextProject: Project | null): void => {
    window.history.pushState(
      {},
      '',
      nextProject ? projectPageUrl(nextProject.id, nextProject.name) : '/',
    )
    setProjectId(nextProject?.id ?? null)
  }, [])

  if (!project) {
    return (
      <ProjectHome
        activity={projectActivity}
        details={projectDetails}
        isDiscovering={isDiscovering}
        projects={projects}
        unavailableProjectIds={unavailableProjectIds}
        onAdd={addProject}
        onOpen={(selected) => navigate(selected)}
        onRemove={removeProject}
      />
    )
  }

  const urlState = projectUrlState(window.location.pathname, window.location.search)
  return (
    <LivecraftProjectApp
      key={project.id}
      project={project}
      initialWorkspacePath={urlState.workspacePath}
      initialSessionPath={urlState.sessionPath}
      onOpenHome={() => navigate(null)}
    />
  )
}

/** Orchestrates workspace state, Pi events, and UI panels for one selected project. */
function LivecraftProjectApp(
  {
    project,
    initialWorkspacePath,
    initialSessionPath,
    onOpenHome,
  }: {
    project: Project
    initialWorkspacePath?: string
    initialSessionPath?: string
    onOpenHome: () => void
  },
) {
  const browserId = primaryBrowserId
  const terminalId = 'main'
  const initialBrowserWorkspacePath = initialWorkspacePath ?? project.root

  // Workspace and sessions
  const [compactingSessionIds, setCompactingSessionIds] = useState<ReadonlySet<string>>(new Set())

  // Conversation and Pi lifecycle
  const [piConnection, setPiConnection] = useState<PiConnection>('connecting')
  const [managerRuntimeStatus, setManagerRuntimeStatus] = useState<ManagerRuntimeStatus>({
    state: 'disconnected',
    canRestart: false,
  })
  const [conversationView, setConversationView] = useState<ConversationView>(() => {
    const stored = window.localStorage.getItem('pi-livecraft.conversation-view')
    if (stored === 'detailed' || stored === 'simple-expanded') return 'detailed'
    if (stored === 'semi-detailed') return 'semi-detailed'
    if (stored === 'simple') return 'simple'
    return window.localStorage.getItem('pi-livecraft.detailed-view') === 'false'
      ? 'simple'
      : 'detailed'
  })
  const changeConversationView = useCallback((next: ConversationView) => {
    setConversationView(next)
    window.localStorage.setItem('pi-livecraft.conversation-view', next)
  }, [])

  // Dialogs and notifications
  const [agentOptions, setAgentOptions] = useState<Record<string, string[]>>({})
  const [agentBusy, setAgentBusy] = useState<Record<string, boolean>>({})
  const [agentOptionsLoading, setAgentOptionsLoading] = useState<Record<string, boolean>>({})
  const agentOptionsLoadingRef = useRef(agentOptionsLoading)
  useEffect(() => {
    agentOptionsLoadingRef.current = agentOptionsLoading
  }, [agentOptionsLoading])
  const [dialog, setDialog] = useState<UiDialog | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  // Workspace tools and sidebars
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(() =>
    readWorkspaceSidebarWidth(window.localStorage.getItem('pi-livecraft.workspace-sidebar-width'))
  )
  const [workspaceSidebarCollapsed, setWorkspaceSidebarCollapsed] = useState(() =>
    readWorkspaceSidebarCollapsed(
      window.localStorage.getItem('pi-livecraft.workspace-sidebar-collapsed'),
    )
  )
  const [workspaceGit, setWorkspaceGit] = useState<Record<string, GitSnapshot>>({})
  const [quotas, setQuotas] = useState<QuotaSnapshot | null>(null)
  const [environment, setEnvironment] = useState<SessionEnvironmentSnapshot | null>(null)
  const [extensionSettings, setExtensionSettings] = useState<ExtensionSettingsSnapshot | null>(
    null,
  )
  const [extensionSettingsError, setExtensionSettingsError] = useState<string | null>(null)
  const [piSettings, setPiSettings] = useState<PiSettingsSnapshot | null>(null)
  const [piSettingsError, setPiSettingsError] = useState<string | null>(null)
  const [browserUrl, setBrowserUrl] = useState(
    () => readBrowserUrl(initialBrowserWorkspacePath, browserId),
  )
  const [activeRightWidget, setActiveRightWidget] = useState<RightWidget | null>(() =>
    readActiveRightWidget(
      window.localStorage.getItem('pi-livecraft.right-sidebar-widget'),
      window.localStorage.getItem('pi-livecraft.git-sidebar-collapsed'),
    )
  )
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readRightSidebarWidth(
      window.localStorage.getItem('pi-livecraft.right-sidebar-width') ?? window
        .localStorage
        .getItem('pi-livecraft.git-sidebar-width'),
    )
  )
  const [filePaneShare, setFilePaneShare] = useState(() =>
    readFilePaneShare(window.localStorage.getItem('pi-livecraft.file-pane-share'))
  )

  // Preferences and commands
  const [themePreferences, setThemePreferences] = useState(() => readThemePreferences())
  const activeTheme = useMemo(() => resolveActiveTheme(themePreferences), [themePreferences])
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Transient UI requests and measurements
  type LoadingPhase = 'hidden' | 'entering' | 'visible' | 'exiting'
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('hidden')
  const [requestedSelect, setRequestedSelect] = useState<'agent' | 'model' | 'thinking' | null>(
    null,
  )
  const [submitRequest, setSubmitRequest] = useState(0)
  const [focusComposerRequest, setFocusComposerRequest] = useState(0)
  const [composerDraftRequest, setComposerDraftRequest] = useState<
    { id: string; message: string; sessionId: string }
  >()
  const [scrollToBottomRequest, setScrollToBottomRequest] = useState(0)
  const [conversationNavigation, setConversationNavigation] = useState<
    { id: number; target: ConversationNavigationTarget }
  >()
  const [shortcuts, setShortcuts] = useState(() => readShortcuts())
  const [terminalCommand, setTerminalCommand] = useState(() => readTerminalCommand())

  // Workspace and session synchronization
  const selectedIdRef = useRef('')
  const replayPiEventRef = useRef<
    (sessionId: string, event: JsonObject, sequence?: number) => void
  >(() => undefined)
  const replayPiEvent = useCallback(
    (sessionId: string, event: JsonObject, sequence?: number): void => {
      replayPiEventRef.current(sessionId, event, sequence)
    },
    [],
  )

  // UI and capability synchronization
  const loadingTimerRef = useRef<number>(0)
  const gitRefreshVersionsRef = useRef(new Map<string, number>())
  const gitRefreshTimerRef = useRef<number | undefined>(undefined)
  const sessionCwdRef = useRef(new Map<string, string>())
  const agentResponsesSentRef = useRef(new Set<string>())

  // Conversation timing and quotas
  const quotaAutoRefreshAtRef = useRef(new Map<string, number>())
  const quotasRef = useRef(quotas)
  quotasRef.current = quotas
  const environmentRef = useRef(environment)
  environmentRef.current = environment
  const selectedShubAgentRef = useRef(false)

  const dismissingRef = useRef(new Set<string>())
  const pendingManagerUnavailableToastsRef = useRef(new Map<string, number>())

  // Notifications
  /** Marks a toast as dismissing, then removes it after the exit animation. */
  const startDismissal = useCallback((id: string) => {
    if (dismissingRef.current.has(id)) return
    dismissingRef.current.add(id)
    setToasts((current) =>
      current.map((toast) => toast.id === id ? { ...toast, dismissing: true } : toast)
    )
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
      dismissingRef.current.delete(id)
    }, 160)
  }, [])

  const showToast = useCallback(
    (kind: Toast['kind'], message: string, sessionId: string | null = selectedIdRef.current) => {
      const toast = { id: crypto.randomUUID(), kind, message, sessionId }
      const publish = () => {
        pendingManagerUnavailableToastsRef.current.delete(toast.id)
        setToasts((current) => [...current, toast])
        window.setTimeout(
          () => startDismissal(toast.id),
          kind === 'error' ? 5000 : 3000,
        )
      }
      if (kind === 'error' && message === managerUnavailableMessage) {
        const timer = window.setTimeout(publish, managerUnavailableToastDelayMs)
        pendingManagerUnavailableToastsRef.current.set(toast.id, timer)
        return
      }
      publish()
    },
    [startDismissal],
  )
  const clearManagerUnavailableToasts = useCallback(() => {
    for (const timer of pendingManagerUnavailableToastsRef.current.values()) {
      window.clearTimeout(timer)
    }
    pendingManagerUnavailableToastsRef.current.clear()
    setToasts((current) => current.filter((toast) => toast.message !== managerUnavailableMessage))
  }, [])
  useEffect(() => () => {
    for (const timer of pendingManagerUnavailableToastsRef.current.values()) {
      window.clearTimeout(timer)
    }
  }, [])

  /** Removes a toast after explicit dismissal or automatic timeout. */
  const dismissToast = useCallback((id: string) => startDismissal(id), [startDismissal])

  /** Restores visible dialogs and resolves stale agent selectors that block manager restart. */
  const handleSessionsRefreshed = useCallback((nextSessions: SessionSummary[]): void => {
    // Restore user-facing dialogs (excludes agent selectors which are handled silently)
    const selectedSessionId = selectedIdRef.current
    const pending = pendingDialogForSession(nextSessions, selectedSessionId)
    setDialog((current) =>
      pending
        ?? (current?.sessionId === selectedSessionId
            && nextSessions.some(({ id }) => id === current.sessionId)
          ? current
          : null)
    )
    // Resolve stale agent selectors that were missed during an SSE disconnect.
    // Options are fetched on demand when the user opens the dropdown.
    for (const session of nextSessions) {
      for (const request of session.pendingUi) {
        if (!isAgentSelector(request)) continue
        const key = `${session.id}:${request.id}`
        if (agentResponsesSentRef.current.has(key)) continue
        agentResponsesSentRef.current.add(key)
        void sendPiCommand(session.id, {
          type: 'extension_ui_response',
          id: request.id,
          cancelled: true,
        })
          .catch((cause) => {
            agentResponsesSentRef.current.delete(key)
            showToast('error', messageOf(cause))
          })
      }
    }
  }, [showToast])
  const handleSessionDraft = useCallback((sessionId: string, message: string): void => {
    setComposerDraftRequest({ id: crypto.randomUUID(), message, sessionId })
  }, [])
  const handleInitialMessageSent = useCallback(
    (): void => setScrollToBottomRequest((current) => current + 1),
    [],
  )
  const handleWorkspaceError = useCallback(
    (cause: unknown): void => showToast('error', messageOf(cause)),
    [showToast],
  )
  const {
    addPendingRequest,
    archivedSessionPaths,
    completedSessionIds,
    creatingSession,
    isRefreshingSessions,
    markSessionCompleted,
    openPinnedSession,
    pinnedSessions,
    projectWorkspaces,
    recentSessions,
    recentWorkspacePaths,
    refreshPinnedSessions,
    refreshSessions,
    removePendingRequest,
    retainNewSession,
    renameManagedSession,
    renameSession,
    selectCreatedSession,
    selectedId,
    sentSessions,
    sessionLoadError,
    sessions,
    titleSessionFromPrompt,
    setSelectedId,
    selectWorkspace,
    startAndSelectSession: startWorkspaceSession,
    startNewSession,
    toggleProjectPin,
    toggleSessionArchive,
    updateSession,
    workspacePath,
    retryProjectDiscovery,
    projectDiscoveryError,
  } = useWorkspaceSessions({
    project,

    initialWorkspacePath,
    initialSessionPath,
    onDraftMessage: handleSessionDraft,
    onError: handleWorkspaceError,
    onInitialMessageSent: handleInitialMessageSent,
    onSessionsRefreshed: handleSessionsRefreshed,
  })
  selectedIdRef.current = selectedId
  for (const session of sessions) sessionCwdRef.current.set(session.id, session.cwd)

  const viewerState = useWorkspaceViewerState(workspacePath, browserId, terminalId)

  useEffect(() => {
    setBrowserUrl(readBrowserUrl(workspacePath, browserId))
  }, [browserId, workspacePath])

  // Keep the project page URL carrying the current workspace and selected session
  // so reloads and duplicated tabs restore the same view. Never removes the last
  // session, so the previously opened one survives a refresh.
  const selectedSessionPath = sessions.find((session) => session.id === selectedId)?.sessionPath
  useEffect(() => {
    if (!window.location.pathname.startsWith('/project/')) return
    const current = projectUrlState(window.location.pathname, window.location.search)
    const path = projectPageUrl(
      project.id,
      project.name,
      workspacePath,
      selectedSessionPath ?? current.sessionPath,
    )
    if (window.location.pathname + window.location.search !== path) {
      window.history.replaceState({}, '', path)
    }
  }, [project.id, project.name, selectedSessionPath, workspacePath])

  const startAndSelectSession = useCallback(
    (
      start: () => Promise<SessionSummary>,
      initialMessage?: string,
      draftMessage?: string,
    ): Promise<SessionSummary | null> =>
      startWorkspaceSession(start, { draftMessage, initialMessage }),
    [startWorkspaceSession],
  )

  const {
    activity,
    addOptimisticUserMessage,
    addPendingSteering,
    clearActivity,
    flushLiveUpdates,
    handlePiEvent,
    liveMessages,
    observedRequestDurations,
    observedToolDurations,
    pendingSteering,
    refreshSnapshot,
    removeLiveMessage,
    removePendingSteering,
    resetEventSequence,
    snapshot,
    snapshotSessionId,
    toolExecutions,
  } = useConversationRuntime(selectedId, handleWorkspaceError, replayPiEvent)
  const handleForkConversation = useCallback(async (entryId: string): Promise<boolean> => {
    const response = await sendPiCommand(selectedId, { type: 'fork', entryId })
    const data = isObject(response.data) ? response.data : undefined
    if (data?.cancelled === true) return false
    if (typeof data?.text === 'string') {
      setComposerDraftRequest({
        id: crypto.randomUUID(),
        message: data.text,
        sessionId: selectedId,
      })
    }
    await Promise.all([refreshSnapshot(selectedId), refreshSessions()])
    return true
  }, [refreshSessions, refreshSnapshot, selectedId])

  const model = isObject(snapshot.state?.model) ? snapshot.state.model : undefined
  const currentQuotaProvider = quotaProviderForModel(model?.provider)
  const currentQuotaProviderRef = useRef(currentQuotaProvider)
  currentQuotaProviderRef.current = currentQuotaProvider

  const visibleToasts = toasts.filter((toast) =>
    toast.sessionId === null || toast.sessionId === selectedId
  )

  // Sidebar preferences
  const updateWorkspaceSidebarWidth = useCallback((width: number) => {
    const nextWidth = clampWorkspaceSidebarWidth(width)
    window.localStorage.setItem('pi-livecraft.workspace-sidebar-width', String(nextWidth))
    setWorkspaceSidebarWidth(nextWidth)
  }, [])

  const updateFilePaneShare = useCallback((share: number) => {
    const nextShare = clampFilePaneShare(share)
    window.localStorage.setItem('pi-livecraft.file-pane-share', String(nextShare))
    setFilePaneShare(nextShare)
  }, [])

  const toggleWorkspaceSidebar = useCallback(() => {
    const nextCollapsed = !workspaceSidebarCollapsed
    window.localStorage.setItem(
      'pi-livecraft.workspace-sidebar-collapsed',
      String(nextCollapsed),
    )
    setWorkspaceSidebarCollapsed(nextCollapsed)
  }, [workspaceSidebarCollapsed])

  const updateRightSidebarWidth = useCallback((width: number) => {
    const nextWidth = clampRightSidebarWidth(width)
    window.localStorage.setItem('pi-livecraft.right-sidebar-width', String(nextWidth))
    setRightSidebarWidth(nextWidth)
  }, [])

  const openRightWidget = useCallback((widget: RightWidget) => {
    window.localStorage.setItem('pi-livecraft.right-sidebar-widget', widget)
    setActiveRightWidget(widget)
  }, [])

  // Theme preferences
  const selectTheme = useCallback((id: string) => {
    setThemePreferences((current) => setActiveTheme(current, id))
  }, [])

  const duplicateActiveTheme = useCallback(() => {
    setThemePreferences((current) => {
      const source = resolveActiveTheme(current)
      const duplicated = duplicateTheme(current, source.id, `${source.name} custom`)
      const created = duplicated.themes.at(-1)
      return created ? setActiveTheme(duplicated, created.id) : duplicated
    })
  }, [])

  const renameSelectedTheme = useCallback((id: string, name: string) => {
    setThemePreferences((current) => renameTheme(current, id, name))
  }, [])

  const updateSelectedThemeColor = useCallback(
    (id: string, variable: ThemeVariable, color: string) => {
      setThemePreferences((current) => updateThemeColor(current, id, variable, color))
    },
    [],
  )

  const deleteSelectedTheme = useCallback((id: string) => {
    setThemePreferences((current) => deleteTheme(current, id))
  }, [])

  const resetSelectedTheme = useCallback((id: string) => {
    setThemePreferences((current) => resetTheme(current, id))
  }, [])

  useEffect(() => {
    persistThemePreferences(themePreferences)
  }, [themePreferences])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = activeTheme.mode
    applyThemePalette(root, activeTheme.palette)
    const shadows = shadowForMode(activeTheme.mode)
    root.style.setProperty('--shadow', shadows.shadow)
    root.style.setProperty('--shadow-soft', shadows['shadow-soft'])
  }, [activeTheme])

  // Dialogs
  /** Clears an answered request immediately, then reconciles all pending requests with the manager. */
  const closeDialog = useCallback((closedDialog: UiDialog) => {
    const requestId = closedDialog.request.id
    setDialog((current) =>
      current?.sessionId === closedDialog.sessionId && current.request.id === requestId
        ? null
        : current
    )
    if (typeof requestId === 'string') removePendingRequest(closedDialog.sessionId, requestId)
    void refreshSessions()
  }, [refreshSessions, removePendingRequest])

  // Workspace capabilities
  /** Refreshes Git state for one workspace. Throws when requested so callers can handle the error. */
  const refreshGit = useCallback(async (cwd = workspacePath, notifyOnError = false) => {
    if (gitRefreshTimerRef.current !== undefined) {
      window.clearTimeout(gitRefreshTimerRef.current)
      gitRefreshTimerRef.current = undefined
    }
    const version = (gitRefreshVersionsRef.current.get(cwd) ?? 0) + 1
    gitRefreshVersionsRef.current.set(cwd, version)
    try {
      const nextSnapshot = await getGitSnapshot(cwd)
      if (gitRefreshVersionsRef.current.get(cwd) === version) {
        setWorkspaceGit((current) => ({ ...current, [cwd]: nextSnapshot }))
      }
    } catch (cause) {
      if (notifyOnError && gitRefreshVersionsRef.current.get(cwd) === version) throw cause
    }
  }, [workspacePath])
  /** Schedules one Git refresh for a burst of completed tools. */
  const scheduleGitRefresh = useCallback((cwd = workspacePath): void => {
    if (gitRefreshTimerRef.current !== undefined)
      window.clearTimeout(gitRefreshTimerRef.current)
    gitRefreshTimerRef.current = window.setTimeout(() => {
      gitRefreshTimerRef.current = undefined
      void refreshGit(cwd)
    }, gitRefreshDelayMs)
  }, [refreshGit, workspacePath])

  /** Refreshes quotas, allowing manual clicks to bypass automatic throttling. */
  const refreshSessionQuotas = useCallback(
    async (sessionId: string, automatic: boolean): Promise<void> => {
      if (!sessionId) throw new Error('An open Pi session is required to refresh quotas.')
      if (automatic) {
        const provider = currentQuotaProviderRef.current
        if (!provider) return
        const lastRefreshAt = Math.max(
          quotasRef
            .current
            ?.[provider]
            .updatedAt ?? 0,
          quotaAutoRefreshAtRef.current.get(sessionId) ?? 0,
        )
        const now = Date.now()
        if (!quotaRefreshAllowed(lastRefreshAt, true, now)) return
        quotaAutoRefreshAtRef.current.set(sessionId, now)
      }
      try {
        setQuotas((current) => current && { ...current, refreshing: true })
        setQuotas(await refreshQuotas(sessionId, automatic))
      } catch (cause) {
        if (!automatic) showToast('error', messageOf(cause))
        setQuotas(await getQuotas().catch(() => quotasRef.current))
      }
    },
    [showToast],
  )

  /** Redeems one banked reset; the extension republishes the report itself. */
  const redeemQuotaReset = useCallback(
    async (target: QuotaResetTarget): Promise<{ ok: boolean; error?: string }> => {
      if (!selectedId) throw new Error('An open Pi session is required to redeem a reset.')
      try {
        return await resetQuota(selectedId, target)
      } catch (cause) {
        showToast('error', messageOf(cause))
        return { ok: false, error: messageOf(cause) }
      } finally {
        setQuotas(await getQuotas().catch(() => quotasRef.current))
      }
    },
    [selectedId, showToast],
  )

  /** Reads the loaded tools and context files from the Pi session. */
  const refreshSessionEnvironment = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!sessionId) throw new Error('An open Pi session is required to refresh the environment.')
      try {
        setEnvironment((current) => current && { ...current, refreshing: true })
        setEnvironment(await refreshEnvironment(sessionId))
      } catch (cause) {
        showToast('error', messageOf(cause))
        setEnvironment(await getEnvironment(sessionId).catch(() => environmentRef.current))
      }
    },
    [showToast],
  )

  /** Sends /agent to Pi, intercepts the resulting selector silently, and caches its options. */
  const fetchAgentOptions = useCallback((sessionId: string) => {
    if (agentOptionsLoadingRef.current[sessionId] || agentOptions[sessionId]) return
    setAgentOptionsLoading((current) => ({ ...current, [sessionId]: true }))
    void sendPiCommand(sessionId, { type: 'prompt', message: '/agent' })
      .catch((cause) => {
        setAgentOptionsLoading((current) => ({ ...current, [sessionId]: false }))
        showToast('error', messageOf(cause))
      })
  }, [agentOptions, showToast])

  /** Activates an agent directly without opening the interactive selector. */
  const activateAgent = useCallback((sessionId: string, agentName: string) => {
    if (agentBusy[sessionId]) return
    setAgentBusy((current) => ({ ...current, [sessionId]: true }))
    void sendPiCommand(sessionId, { type: 'prompt', message: `/agent ${agentName}` })
      .then(() => refreshSnapshot(sessionId))
      .catch((cause) => showToast('error', messageOf(cause)))
      .finally(() => setAgentBusy((current) => ({ ...current, [sessionId]: false })))
  }, [agentBusy, refreshSnapshot, showToast])

  /** Drops session-keyed caches when a Pi session exits. */
  const clearSessionCaches = useCallback((sessionId: string): void => {
    setAgentOptions((current) => removeRecordKey(current, sessionId))
    setAgentBusy((current) => removeRecordKey(current, sessionId))
    setAgentOptionsLoading((current) => removeRecordKey(current, sessionId))
    setCompactingSessionIds((current) => {
      if (!current.has(sessionId)) return current
      const next = new Set(current)
      next.delete(sessionId)
      return next
    })
    quotaAutoRefreshAtRef.current.delete(sessionId)
    const prefix = `${sessionId}:`
    for (const key of agentResponsesSentRef.current) {
      if (key.startsWith(prefix)) agentResponsesSentRef.current.delete(key)
    }
  }, [])

  // Initial application synchronization
  /** Every discovered workspace path, stable across renders via the joined key. */
  const gitWorkspacePaths = projectWorkspaces[project.root]
    ?.workspaces
    .map(({ path }) => path)
    .join('\u0000')
  useEffect(() => {
    const paths = gitWorkspacePaths ? gitWorkspacePaths.split('\u0000') : [workspacePath]
    if (gitWorkspacePaths) {
      const knownPaths = new Set(paths)
      setWorkspaceGit((current) => {
        let next = current
        for (const path of Object.keys(current)) {
          if (!knownPaths.has(path)) {
            if (next === current) next = { ...current }
            delete next[path]
          }
        }
        return next
      })
    }
    for (const path of paths) void refreshGit(path)
  }, [gitWorkspacePaths, refreshGit, workspacePath])
  useEffect(() => () => {
    if (gitRefreshTimerRef.current !== undefined) {
      window.clearTimeout(gitRefreshTimerRef.current)
      gitRefreshTimerRef.current = undefined
    }
  }, [])

  useEffect(() => {
    void getQuotas().then(setQuotas).catch(() => undefined)
  }, [])

  // Per-session environment: the selected session's report only. Subagent child
  // sessions are skipped: fetching would describe the ordinary viewer process
  // reopened for display, not the isolated one-shot run.
  useEffect(() => {
    setEnvironment(null)
    if (!selectedId || selectedShubAgentRef.current) return
    void getEnvironment(selectedId).then(setEnvironment).catch(() => undefined)
  }, [selectedId])

  // Pi extension settings: published by the extensions themselves, read when the modal opens.
  const loadExtensionSettings = useCallback(() => {
    setExtensionSettingsError(null)
    void getExtensionSettings()
      .then(setExtensionSettings)
      .catch((cause) => setExtensionSettingsError(messageOf(cause)))
  }, [])

  useEffect(() => {
    if (settingsOpen) loadExtensionSettings()
  }, [settingsOpen, loadExtensionSettings])

  const changeExtensionSetting = useCallback(
    (extension: string, id: string, value: ExtensionSettingValue | null) => {
      void updateExtensionSetting(extension, id, value)
        .then(setExtensionSettings)
        .catch((cause) => {
          showToast('error', messageOf(cause))
          setExtensionSettingsError(messageOf(cause))
        })
    },
    [showToast],
  )

  // Pi settings: read from Pi's own settings.json files when the modal opens or the workspace changes.
  const loadPiSettings = useCallback(() => {
    setPiSettingsError(null)
    void getPiSettings(workspacePath)
      .then(setPiSettings)
      .catch((cause) => setPiSettingsError(messageOf(cause)))
  }, [workspacePath])

  useEffect(() => {
    if (settingsOpen) loadPiSettings()
  }, [settingsOpen, loadPiSettings])

  const changePiSetting = useCallback(
    (scope: PiSettingsScope, id: string, value: PiSettingValue | null) => {
      void updatePiSetting(scope, workspacePath, id, value)
        .then(setPiSettings)
        .catch((cause) => {
          showToast('error', messageOf(cause))
          setPiSettingsError(messageOf(cause))
        })
    },
    [showToast, workspacePath],
  )

  const savePiSettings = useCallback(
    (scope: PiSettingsScope, text: string) => {
      void savePiSettingsDocument(scope, workspacePath, text)
        .then((snapshot) => {
          setPiSettings(snapshot)
          showToast('notice', 'Saved. Applies to Pi sessions started from now on.')
        })
        .catch((cause) => showToast('error', messageOf(cause)))
    },
    [showToast, workspacePath],
  )

  // Selected session synchronization
  useEffect(() => setConversationNavigation(undefined), [selectedId])

  // Pi event stream
  /** Routes a live or replayed Pi event through cross-feature effects before the conversation runtime. */
  const handleManagerPiEvent = useCallback(
    (sessionId: string, event: JsonObject, sequence?: number): void => {
      if (event.type === 'session_info_changed') {
        const name = typeof event.name === 'string' && event.name.trim()
          ? event.name.trim()
          : 'New session'
        renameSession(sessionId, name)
      }
      if (event.type === 'agent_start') updateSession(sessionId, { status: 'running' })
      if (event.type === 'agent_settled') {
        updateSession(sessionId, { status: 'idle' })
        markSessionCompleted(sessionId)
      }
      if (event.type === 'compaction_start')
        setCompactingSessionIds((current) => new Set(current).add(sessionId))
      if (event.type === 'compaction_end')
        setCompactingSessionIds((current) => {
          if (!current.has(sessionId)) return current
          const next = new Set(current)
          next.delete(sessionId)
          return next
        })
      if (
        event.type === 'auto_retry_end' && event.success === false && typeof event
            .finalError === 'string'
      ) {
        showToast(
          'error',
          `Provider connection failed after retries: ${event.finalError}`,
          sessionId,
        )
      }
      if (event.type === 'tool_execution_end')
        scheduleGitRefresh(sessionCwdRef.current.get(sessionId))
      if (
        event.type === 'extension_ui_request' && event.method === 'setStatus'
        && event.statusKey === 'agent'
      ) {
        updateSession(sessionId, {
          activeAgent: typeof event.activeAgent === 'string' ? event.activeAgent : undefined,
        })
      }
      if (
        event.type === 'extension_ui_request' && event.method === 'setStatus'
        && event.statusKey === 'pi-livecraft.quotas'
      ) {
        void getQuotas().then(setQuotas).catch(() => undefined)
      }
      if (
        event.type === 'extension_ui_request' && event.method === 'setStatus'
        && event.statusKey === 'pi-livecraft.environment'
      ) {
        if (sessionId === selectedIdRef.current && !selectedShubAgentRef.current)
          void getEnvironment(sessionId).then(setEnvironment).catch(() => undefined)
      }
      if (
        event.type === 'extension_ui_request' && isBlockingDialog(event) && !isAgentSelector(event)
      ) {
        // Commit batched assistant deltas before a blocking dialog covers the conversation.
        if (sessionId === selectedIdRef.current) flushLiveUpdates()
        if (typeof event.id === 'string') addPendingRequest(sessionId, event)
        if (sessionId === selectedIdRef.current) clearActivity()
      }
      if (event.type === 'extension_ui_request') {
        if (
          event.method === 'notify' || (event.method === 'setStatus' && event.statusKey === 'agent')
        ) selectCreatedSession(sessionId)
        if (event.method === 'notify' && typeof event.message === 'string')
          showToast(event.notifyType === 'error' ? 'error' : 'notice', event.message, sessionId)
        // Intercept agent selector silently when Livecraft requested the options list.
        if (isAgentSelector(event) && agentOptionsLoadingRef.current[sessionId]) {
          const options = event.options.filter((o): o is string => typeof o === 'string')
          setAgentOptions((current) => ({ ...current, [sessionId]: options }))
          setAgentOptionsLoading((current) => ({ ...current, [sessionId]: false }))
          void sendPiCommand(sessionId, {
            type: 'extension_ui_response',
            id: event.id,
            cancelled: true,
          })
            .catch((cause) => showToast('error', messageOf(cause)))
          return
        }
        if (isAgentSelector(event)) {
          // Pi-initiated selector (e.g. user typed /agent in Pi terminal) — show as normal dialog.
          if (isBlockingDialog(event) && sessionId === selectedIdRef.current)
            setDialog({ sessionId, request: event })
          return
        }
        if (isBlockingDialog(event) && sessionId === selectedIdRef.current)
          setDialog({ sessionId, request: event })
      }

      const selected = sessionId === selectedIdRef.current
      if (selected && event.type === 'agent_settled') void refreshSessionQuotas(sessionId, true)
      handlePiEvent(sessionId, event, sequence)
      if (selected && event.type === 'agent_settled')
        setFocusComposerRequest((current) => current + 1)
    },
    [
      addPendingRequest,
      clearActivity,
      flushLiveUpdates,
      handlePiEvent,
      markSessionCompleted,
      refreshSessionQuotas,
      scheduleGitRefresh,
      renameSession,
      selectCreatedSession,
      showToast,
      updateSession,
    ],
  )
  replayPiEventRef.current = handleManagerPiEvent
  // The subscription below must not resubscribe when workspace-dependent handlers change
  // identity: every resubscription reconnects /api/events and replays the event stream.
  const refreshSessionsRef = useRef<() => void>(() => undefined)
  refreshSessionsRef.current = refreshSessions
  const updateSessionRef = useRef(updateSession)
  updateSessionRef.current = updateSession

  useEffect(() =>
    subscribeManagerEvents((managerEvent) => {
      if (
        managerEvent.event === 'manager_connected' || managerEvent.event === 'manager_disconnected'
      ) {
        setPiConnection(managerEvent.event === 'manager_connected' ? 'connected' : 'disconnected')
        if (managerEvent.event === 'manager_connected') clearManagerUnavailableToasts()
        clearActivity()
      }
      if (managerEvent.event === 'manager_status' && isManagerRuntimeStatus(managerEvent.data))
        setManagerRuntimeStatus(managerEvent.data)
      if (managerEvent.event === 'session_exited') {
        updateSessionRef.current(managerEvent.sessionId, { status: 'exited' })
        clearSessionCaches(managerEvent.sessionId)
        sessionCwdRef.current.delete(managerEvent.sessionId)
      } else if (
        managerEvent.event === 'manager_connected' || managerEvent.event === 'session_created'
        || managerEvent.event === 'session_reassigned'
      ) void refreshSessionsRef.current()
      if (managerEvent.event === 'pi' && isObject(managerEvent.data))
        replayPiEventRef.current(
          managerEvent.sessionId,
          managerEvent.data,
          managerEvent.sequence,
        )
    }, () => {
      resetEventSequence()
      setPiConnection('connecting')
      clearActivity()
      showToast('error', 'Connection to backend lost; retrying.')
    }, () => setPiConnection('connected')), [
    clearActivity,
    clearManagerUnavailableToasts,
    clearSessionCaches,
    resetEventSequence,
    showToast,
  ])

  // Selected session and loading state
  const selectedSession = sessions.find((session) => session.id === selectedId)
  const selectedRecentSession = selectedSession
    ? shubAgentMarker(selectedSession, recentSessions)
    : undefined
  const selectedSessionIsShubAgent = selectedRecentSession !== undefined
  selectedShubAgentRef.current = selectedSessionIsShubAgent
  const selectedShubAgentName = selectedRecentSession?.shubAgent
  const currentProjectWorkspace = projectWorkspaces[project.root]?.workspaces.find(
    (workspace) => workspace.path === workspacePath,
  )
  const workspaceName = currentProjectWorkspace?.main
    ? 'Main'
    : workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ?? workspacePath
  const vscodeWorkspaceName = currentProjectWorkspace?.branch ?? workspaceName
  const isMainWorktree = currentProjectWorkspace?.main === true || workspacePath === project.root
  const vscodeColor = worktreeColor(project.root, workspacePath, project.color)
  const selectedSessionId = selectedSession?.id
  const selectedSessionStatus = selectedSession?.status
  const sessionIsLoading = Boolean(selectedSessionId && snapshotSessionId !== selectedSessionId)

  // Manages loading overlay fade-in / fade-out around snapshot refresh.
  useEffect(() => {
    window.clearTimeout(loadingTimerRef.current)
    if (!selectedSessionId) {
      setLoadingPhase('hidden')
      return
    }
    if (sessionIsLoading) {
      setLoadingPhase('entering')
      loadingTimerRef.current = window.setTimeout(() => setLoadingPhase('visible'), 200)
    } else {
      setLoadingPhase('exiting')
      loadingTimerRef.current = window.setTimeout(() => setLoadingPhase('hidden'), 200)
    }
    return () => window.clearTimeout(loadingTimerRef.current)
  }, [selectedSessionId, sessionIsLoading])

  const displayedActivity = selectedSession?.id && compactingSessionIds.has(selectedSession.id)
    ? { kind: 'compacting' as const }
    : selectedSession
    ? sessionActivity(activity, selectedSession.status, piConnection)
    : null

  // Composer and session lifecycle
  const handleConversationError = useCallback(
    (cause: unknown) => showToast('error', messageOf(cause)),
    [showToast],
  )
  const handleComposerAgentChange = useCallback(
    (agent: string) => activateAgent(selectedId, agent),
    [activateAgent, selectedId],
  )
  /** Executes a composer command and synchronizes capabilities affected by it. */
  const handleComposerCommand = useCallback(async (command: JsonObject) => {
    const result = await sendPiCommand(selectedId, command)
    await refreshSnapshot(selectedId)
    if (command.type === 'compact') showToast('notice', 'Session compacted.')
    return result
  }, [refreshSnapshot, selectedId, showToast])
  /** Sends the current draft with the behavior supported by the active session. */
  const handleComposerSend = useCallback(
    async (
      message: string,
      images: JsonObject[],
      behavior: 'steer' | 'followUp',
      isCommand: boolean,
    ) => {
      if (selectedSessionIsShubAgent) return
      const command: JsonObject = { type: 'prompt', message, images }
      const isSteering = !isCommand && selectedSessionStatus === 'running' && behavior === 'steer'
      if (selectedSessionStatus === 'running') command.streamingBehavior = behavior
      if (isSteering) addPendingSteering(message)
      const optimisticId = !isSteering && !isCommand ? addOptimisticUserMessage(message) : undefined
      try {
        await sendPiCommand(selectedId, command)
        if (!isCommand) {
          retainNewSession(selectedId)
          titleSessionFromPrompt(selectedId, message)
        }
        setScrollToBottomRequest((current) => current + 1)
      } catch (cause) {
        if (optimisticId) removeLiveMessage(optimisticId)
        if (isSteering) removePendingSteering(message)
        throw cause
      }
    },
    [
      addOptimisticUserMessage,
      addPendingSteering,
      removeLiveMessage,
      removePendingSteering,
      retainNewSession,
      selectedId,
      selectedSessionIsShubAgent,
      selectedSessionStatus,
      titleSessionFromPrompt,
    ],
  )
  /** Retracts one queued steering message while preserving the rest of Pi's queues. */
  const handleRetractSteering = useCallback(
    async (index: number, message: string): Promise<void> => {
      const response = await sendPiCommand(selectedId, { type: 'clear_queue' })
      const data = isObject(response.data) ? response.data : null
      const steering = Array.isArray(data?.steering)
        ? data.steering.filter((message): message is string => typeof message === 'string')
        : []
      const followUp = Array.isArray(data?.followUp)
        ? data.followUp.filter((message): message is string => typeof message === 'string')
        : []
      const targetIndex = index >= 0 && index < steering.length && steering[index] === message
        ? index
        : steering.indexOf(message)
      const remainingSteering = targetIndex >= 0
        ? steering.toSpliced(targetIndex, 1)
        : steering
      for (const message of remainingSteering) {
        await sendPiCommand(selectedId, { type: 'steer', message })
      }
      for (const message of followUp) {
        await sendPiCommand(selectedId, { type: 'follow_up', message })
      }
    },
    [selectedId],
  )
  const handleComposerAbort = useCallback(() => sendPiCommand(selectedId, { type: 'abort' }), [
    selectedId,
  ])
  /** Resends a failed turn's prompt as a fresh follow-up message. */
  const retryConversationPrompt = useCallback(
    async (prompt: string): Promise<void> => {
      await handleComposerSend(prompt, [], 'followUp', false)
    },
    [handleComposerSend],
  )
  /** Starts a real Pi session in the current workspace (sidebar + / empty-state CTA). */
  const handleNewSession = useCallback(async (): Promise<void> => {
    await startNewSession(() => createSession(workspacePath))
  }, [startNewSession, workspacePath])
  /** Re-runs the session list refresh after a failed load. */
  const handleRetrySessions = useCallback((): void => {
    void refreshSessions()
  }, [refreshSessions])
  const handlePromptImprovement = useCallback(
    (prompt: string, direction?: string) => {
      if (!selectedId)
        return Promise.reject(new Error('Start the session before improving prompts'))
      return improvePrompt(selectedId, prompt, direction)
    },
    [selectedId],
  )
  /** Persists the draft through Pi's prompt directories and confirms its scope to the user. */
  const handleSavePrompt = useCallback(async (
    scope: 'global' | 'project',
    name: string,
    content: string,
  ) => {
    const saved = await savePrompt(selectedSession?.cwd ?? workspacePath, scope, name, content)
    showToast(
      'notice',
      `Prompt “${name}” saved ${scope === 'global' ? 'globally' : 'for this project'}.`,
    )
    return saved
  }, [selectedSession?.cwd, showToast, workspacePath])
  const handleComposerSelectOpened = useCallback(() => setRequestedSelect(null), [])
  /** Kept stable so streamed updates do not defeat each tool call card's memoization. */
  const handleOpenShubAgentSession = useCallback(
    (cwd: string, sessionPath: string): Promise<void> => openPinnedSession({ cwd, sessionPath }),
    [openPinnedSession],
  )
  const analysisAvailable = selectedSession !== undefined
    && snapshotSessionId === selectedSession.id
  const sessionAnalysis = useMemo(() =>
    !analysisAvailable || activeRightWidget !== 'analysis'
      ? null
      : analyzeSession(snapshot.messages, snapshot.stats, selectedSession.status === 'running', {
        requestDurations: observedRequestDurations,
        toolDurations: observedToolDurations,
        toolExecutions,
      }), [
    activeRightWidget,
    analysisAvailable,
    observedRequestDurations,
    observedToolDurations,
    selectedSession,
    snapshot.messages,
    snapshot.stats,
    toolExecutions,
  ])
  const pendingDialog = pendingDialogForSession(sessions, selectedId)
  const visibleDialog = pendingDialog ?? visibleDialogForSession(dialog, selectedId)
  const questionnaire = visibleDialog && isAskUserQuestionDialog(visibleDialog.request)
    ? visibleDialog
    : null
  const questionnaireSession = questionnaire
    ? sessions.find((session) => session.id === questionnaire.sessionId)
    : undefined
  const questionnaireInComposer = questionnaire?.sessionId === selectedId
    && snapshotSessionId === selectedId
  const openQuestionnaireSession = questionnaireSession && questionnaireSession.id !== selectedId
    ? () =>
      questionnaireSession.cwd === workspacePath
        ? setSelectedId(questionnaireSession.id)
        : selectWorkspace(questionnaireSession.cwd, questionnaireSession.id)
    : undefined

  const markComposerDraftApplied = useCallback((id: string) => {
    setComposerDraftRequest((current) => current?.id === id ? undefined : current)
  }, [])

  // Commands and keyboard shortcuts
  /** Executes a productivity command in the context of the active session. */
  const executeCommand = useCallback((id: CommandId): void => {
    // Read-only shub-agent child sessions have no composer or session selects;
    // their shortcuts and palette entries would be silent no-ops.
    if (selectedShubAgentRef.current && shubReadOnlyCommands.includes(id)) return
    const rightWidget = rightWidgetFromCommand(id)
    if (rightWidget) {
      if (rightWidget === 'analysis' && !analysisAvailable) return
      openRightWidget(rightWidget)
      return
    }
    if (id === 'open-palette') {
      setCommandPaletteOpen(true)
      return
    }
    if (id === 'open-settings') {
      setSettingsOpen(true)
      return
    }
    if (id === 'open-terminal') {
      void openTerminal(workspacePath, terminalCommand).catch((cause) =>
        showToast('error', messageOf(cause))
      )
      return
    }
    if (id === 'open-vscode') {
      void openVSCode(
        workspacePath,
        project.name,
        vscodeWorkspaceName,
        vscodeColor,
        isMainWorktree,
      )
        .catch((cause) => showToast('error', messageOf(cause)))
      return
    }
    if (id === 'new-session') {
      void startNewSession(() => createSession(workspacePath))
      return
    }
    if (id === 'send') {
      setSubmitRequest((current) => current + 1)
      return
    }
    if (id === 'abort' && selectedId) {
      void sendPiCommand(selectedId, { type: 'abort' }).catch((cause) =>
        showToast('error', messageOf(cause))
      )
      return
    }
    if (id === 'open-agent' || id === 'open-model' || id === 'open-thinking') {
      setRequestedSelect(id === 'open-agent' ? 'agent' : id === 'open-model' ? 'model' : 'thinking')
      return
    }
    if (id === 'copy-last-response') {
      const text = lastAssistantText(snapshot.messages)
      if (!text) {
        showToast('notice', 'No assistant response to copy.')
        return
      }
      void navigator
        .clipboard
        .writeText(text)
        .then(() => showToast('notice', 'Last response copied.'))
        .catch((cause) => showToast('error', messageOf(cause)))
      return
    }
    if (id === 'open-directory-picker') {
      onOpenHome()
      return
    }
    if (id === 'workspace-previous' && recentWorkspacePaths.length > 1) {
      selectWorkspace(recentWorkspacePaths[1])
      return
    }
    if (id === 'focus-composer') {
      setFocusComposerRequest((current) => current + 1)
      return
    }
    if (id === 'next-session' || id === 'previous-session') {
      const visible = sidebarSessions(recentSessions, workspacePath, sentSessions)
      const currentIndex = visible.findIndex((session) => session.id === selectedId)
      const targetIndex = id === 'next-session' ? currentIndex + 1 : currentIndex - 1
      if (targetIndex >= 0 && targetIndex < visible.length) setSelectedId(visible[targetIndex].id)
      return
    }
    if (id === 'toggle-conversation-view') {
      setConversationView((current) => {
        const next = nextConversationView(current)
        window.localStorage.setItem('pi-livecraft.conversation-view', next)
        return next
      })
      return
    }
    if (id === 'open-explorer') {
      void openExplorer(workspacePath).catch((cause) => showToast('error', messageOf(cause)))
      return
    }
  }, [
    openRightWidget,
    recentSessions,
    recentWorkspacePaths,
    selectWorkspace,
    selectedId,
    sentSessions,
    analysisAvailable,
    onOpenHome,
    setSelectedId,
    showToast,
    snapshot.messages,
    startNewSession,
    terminalCommand,
    isMainWorktree,
    vscodeWorkspaceName,
    workspacePath,
    project.name,
    vscodeColor,
  ])

  const paletteCommands: PaletteCommand[] = useMemo(() => {
    const visibleIds = sidebarSessions(recentSessions, workspacePath, sentSessions).map((session) =>
      session.id
    )
    const selectedIndex = selectedId ? visibleIds.indexOf(selectedId) : -1
    return commandDefinitions.map((definition) => {
      const rightWidget = rightWidgetFromCommand(definition.id)
      const unavailableWidget = rightWidget === 'analysis' && !analysisAvailable
      return {
        ...definition,
        shortcut: shortcuts[definition.id],
        disabled: unavailableWidget
          || ([
              'send',
              'abort',
              'open-thinking',
              'open-model',
              'open-agent',
              'copy-last-response',
            ] as CommandId[])
              .includes(definition.id) && !selectedSession
          || (selectedSessionIsShubAgent && shubReadOnlyCommands.includes(definition.id))
          || (definition.id === 'abort' && selectedSession?.status !== 'running')
          || (definition.id === 'workspace-previous' && recentWorkspacePaths.length < 2)
          || (definition.id === 'next-session'
            && (selectedIndex === -1 || selectedIndex >= visibleIds.length - 1))
          || (definition.id === 'previous-session' && selectedIndex <= 0),
        onExecute: () => executeCommand(definition.id),
      }
    })
  }, [
    executeCommand,
    recentSessions,
    recentWorkspacePaths,
    selectedId,
    selectedSession,
    selectedSessionIsShubAgent,
    sentSessions,
    analysisAvailable,
    shortcuts,
    workspacePath,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement
        && (target.closest('.browser-view') || target.closest('.terminal-view'))
      ) return
      if (
        target instanceof HTMLElement && (target
          .isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        && event.key !== 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey
      ) return
      const shortcut = shortcutFromEvent(event)
      const command = (Object.entries(shortcuts) as [CommandId, string | undefined][])
        .find(([, value]) => value === shortcut)
        ?.[0]
      if (!command) return
      if (
        event.key === 'Escape' && (commandPaletteOpen || settingsOpen || visibleDialog || document
          .querySelector(
            '[aria-modal="true"],.composer-select-content,[data-radix-select-content],.slash-commands',
          ))
      ) return
      event.preventDefault()
      executeCommand(command)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commandPaletteOpen, executeCommand, settingsOpen, shortcuts, visibleDialog])

  /** Positions the conversation on an element chosen from a session navigation widget. */
  const navigateToConversationTarget = useCallback((target: ConversationNavigationTarget): void => {
    if (target.kind === 'tool' || target.kind === 'turn') {
      setConversationView('detailed')
      window.localStorage.setItem('pi-livecraft.conversation-view', 'detailed')
    }
    setConversationNavigation((current) => ({ id: (current?.id ?? 0) + 1, target }))
  }, [])

  // Application layout
  const rightPanelVisible = activeRightWidget === 'index'
    || activeRightWidget === 'quotas' || activeRightWidget === 'environment'
    || activeRightWidget === 'browser' || activeRightWidget === 'analysis'
    || activeRightWidget === 'diagnostics'

  if (projectDiscoveryError) {
    return (
      <main className='project-unavailable'>
        <section className='welcome'>
          <span className='brand-mark large'>π</span>
          <h1>Repository unavailable</h1>
          <p>
            {project.name}{' '}
            can't be opened. It may have been moved, deleted, or is no longer a Git repository.
          </p>
          <button className='welcome-action' onClick={retryProjectDiscovery} type='button'>
            Retry
          </button>
          <button className='welcome-action' onClick={onOpenHome} type='button'>
            Back to projects
          </button>
        </section>
      </main>
    )
  }

  return (
    <div
      className={`app-shell project-themed ${
        workspaceSidebarCollapsed ? 'workspace-sidebar-collapsed ' : ''
      }${rightPanelVisible ? 'right-sidebar-visible' : 'right-sidebar-collapsed'}`}
      style={{
        '--project-color': project.color,
        '--right-sidebar-width': `${rightSidebarWidth}px`,
        '--workspace-sidebar-width': `${workspaceSidebarWidth}px`,
        '--file-pane-share': `${filePaneShare * 100}%`,
      } as CSSProperties}
    >
      <WorkspaceSidebar
        archivedSessionPaths={archivedSessionPaths}
        collapsed={workspaceSidebarCollapsed}
        compactingSessionIds={compactingSessionIds}
        completedSessionIds={completedSessionIds}
        isRefreshing={isRefreshingSessions}
        pinnedSessions={pinnedSessions}
        recentSessions={recentSessions}
        sentSessions={sentSessions}
        sessions={sessions}
        selectedId={selectedId}
        width={workspaceSidebarWidth}
        workspacePath={workspacePath}
        project={project}
        projectDetails={projectWorkspaces[project.root]}
        onOpenPinnedSession={openPinnedSession}
        onNewSession={handleNewSession}
        onRefreshSessions={() => {
          void refreshSessions()
          void refreshPinnedSessions()
        }}
        onRefreshWorkspaces={retryProjectDiscovery}
        onOpenSession={async (recentSession) => {
          await startAndSelectSession(() => openSession(workspacePath, recentSession.sessionPath))
        }}
        onOpenVSCode={(workspace) => {
          void openVSCode(
            workspace.path,
            project.name,
            workspace.branch ?? workspace.path,
            worktreeColor(project.root, workspace.path, project.color),
            workspace.main,
          )
            .catch((cause) => showToast('error', messageOf(cause)))
        }}
        onSelectWorkspace={selectWorkspace}
        onSelectSession={setSelectedId}
        onError={(cause) => showToast('error', messageOf(cause))}
        onOpenSettings={() => setSettingsOpen(true)}
        workspaceGit={workspaceGit}
        onGitCommit={async (message) => {
          await commitChanges(workspacePath, message)
        }}
        onGitDiscard={async (path) => {
          await discardChanges(workspacePath, path)
        }}
        onGitPull={() => pullCommits(workspacePath)}
        onGitPush={() => pushCommits(workspacePath)}
        onGitFileSelect={(path, commitHash) => getGitFileDiff(workspacePath, path, commitHash)}
        onGitRefresh={() => refreshGit(workspacePath, true)}
        onGitReset={async (hash) => {
          return await resetGitCommit(workspacePath, hash)
        }}
        onGitRevert={async (hash) => {
          return await revertGitCommit(workspacePath, hash)
        }}
        onOpenFile={viewerState.handleOpenFile}
        onRenameSession={renameManagedSession}
        onResize={updateWorkspaceSidebarWidth}
        onToggleCollapsed={toggleWorkspaceSidebar}
        onToggleProjectPin={toggleProjectPin}
        onToggleSessionArchive={toggleSessionArchive}
      />

      <main className='workspace'>
        <ManagerRuntimeNotice
          activeSession={sessions.some(({ status }) =>
            status === 'running' || status === 'starting'
          )}
          status={managerRuntimeStatus}
          onError={(cause) => showToast('error', messageOf(cause))}
          onRestart={restartManager}
        />
        {selectedSession
          ? (
            <>
              <ChatTopBar
                running={selectedSession.status === 'running'}
                session={selectedSession}
                stats={snapshot.stats}
                compacting={displayedActivity?.kind === 'compacting'}
                conversationView={conversationView}
                onConversationViewChange={changeConversationView}
              />
              {(snapshotSessionId === selectedSession.id || loadingPhase === 'exiting') && (
                <>
                  <div className='conversation-panel'>
                    <Conversation
                      activity={displayedActivity}
                      agentName={selectedSession.activeAgent}
                      conversationView={conversationView}
                      key={selectedSession.id}
                      liveMessages={liveMessages}
                      messages={snapshot.messages}
                      navigationRequest={conversationNavigation}
                      onError={handleConversationError}
                      onFork={handleForkConversation}
                      onOpenShubAgentSession={handleOpenShubAgentSession}
                      onRetry={retryConversationPrompt}
                      onRetractSteering={handleRetractSteering}
                      pendingSteering={pendingSteering}
                      repositoryRoot={workspaceGit[workspacePath]?.root}
                      requestDurations={observedRequestDurations}
                      scrollToBottomRequest={scrollToBottomRequest}
                      workingDirectory={selectedSession.cwd}
                      toolDurations={observedToolDurations}
                      toolExecutions={toolExecutions}
                    />
                  </div>
                  <div className='composer-area'>
                    {questionnaire && questionnaireInComposer && (
                      <AskUserQuestionDialog
                        canMinimize
                        dialog={questionnaire}
                        key={String(
                          questionnaire
                            .request
                            .id,
                        )}
                        sessionName={selectedSession.name}
                        onClose={() => closeDialog(questionnaire)}
                        onError={(cause) => showToast('error', messageOf(cause))}
                      />
                    )}
                    <ToastStack onDismiss={dismissToast} toasts={visibleToasts} />
                    <Composer
                      key={selectedSession.id}
                      session={selectedSession}
                      snapshot={snapshot}
                      agentBusy={Boolean(agentBusy[selectedSession.id])}
                      agentOptions={agentOptions[selectedSession.id] ?? emptyAgentOptions}
                      agentOptionsLoading={Boolean(agentOptionsLoading[selectedSession.id])}
                      selectedAgent={selectedSession.activeAgent ?? ''}
                      onAgentChange={handleComposerAgentChange}
                      onRequestAgentOptions={() => fetchAgentOptions(selectedSession.id)}
                      onCommand={handleComposerCommand}
                      commands={snapshot.commands}
                      agentLoading={snapshotSessionId !== selectedSession.id}
                      focusRequest={focusComposerRequest}
                      draftRequest={composerDraftRequest?.sessionId === selectedSession.id
                        ? composerDraftRequest
                        : undefined}
                      onDraftApplied={markComposerDraftApplied}
                      showAgentSelector={snapshotSessionId !== selectedSession.id
                        || snapshot.commands.some((command) => command.name === 'agent')}
                      running={selectedSession.status === 'running'}
                      onSend={handleComposerSend}
                      onAbort={handleComposerAbort}
                      onImprovePrompt={handlePromptImprovement}
                      onSavePrompt={handleSavePrompt}
                      onError={handleConversationError}
                      readOnly={selectedSessionIsShubAgent}
                      shubContextTokens={selectedRecentSession?.shubContextTokens}
                      requestedSelect={requestedSelect}
                      onSelectOpened={handleComposerSelectOpened}
                      submitRequest={submitRequest}
                    />
                  </div>
                </>
              )}
              {loadingPhase !== 'hidden' && (
                <>
                  <section
                    aria-busy={loadingPhase !== 'exiting' ? true : undefined}
                    aria-live={loadingPhase !== 'exiting' ? 'polite' : undefined}
                    className={`welcome session-loading session-loading-${loadingPhase}`}
                  >
                    <span className='brand-mark large brand-mark-loading'>π</span>
                    <h1>Connecting to Pi…</h1>
                    <p>Loading the session and its capabilities.</p>
                    <span aria-hidden='true' className='session-loading-indicator' />
                  </section>
                  {loadingPhase !== 'exiting' && (
                    <ToastStack onDismiss={dismissToast} standalone toasts={visibleToasts} />
                  )}
                </>
              )}
            </>
          )
          : creatingSession
          ? (
            <>
              <section className='welcome' aria-busy='true'>
                <span className='brand-mark large brand-mark-loading'>π</span>
                <h1>Starting new session…</h1>
                <p>Initializing Pi and its agents.</p>
                <span aria-hidden='true' className='session-loading-indicator' />
              </section>
              <ToastStack onDismiss={dismissToast} standalone toasts={visibleToasts} />
            </>
          )
          : (
            <>
              <section className='welcome'>
                <span className='brand-mark large'>π</span>
                {sessionLoadError
                  ? (
                    <>
                      <h1>Couldn't load sessions</h1>
                      <p>{messageOf(sessionLoadError)}</p>
                      <button
                        className='welcome-action'
                        onClick={handleRetrySessions}
                        type='button'
                      >
                        Retry
                      </button>
                    </>
                  )
                  : isRefreshingSessions && sessions.length === 0
                  ? (
                    <>
                      <h1>Loading sessions…</h1>
                      <p>Reading this workspace's Pi sessions.</p>
                    </>
                  )
                  : sessions.length === 0
                  ? (
                    <>
                      <h1>No sessions yet</h1>
                      <p>This workspace has no Pi sessions. Start one to begin.</p>
                      <button className='welcome-action' onClick={handleNewSession} type='button'>
                        Start a session
                      </button>
                    </>
                  )
                  : (
                    <>
                      <h1>No session selected</h1>
                      <p>Choose a session from the sidebar to continue.</p>
                    </>
                  )}
              </section>
              <ToastStack onDismiss={dismissToast} toasts={visibleToasts} />
            </>
          )}
        <FileContentPane
          activePath={viewerState.activeView?.kind === 'file'
            ? viewerState.activeView.path
            : null}
          browserActive={viewerState.activeView?.kind === 'browser'
            && viewerState.activeView.browserId === browserId}
          browserId={browserId}
          browserOpen={viewerState.browserOpen}
          browserUrl={browserUrl}
          key={workspacePath}
          onActivate={viewerState.handleActivateFile}
          onActivateBrowser={viewerState.handleActivateBrowser}
          onActivateTerminal={viewerState.handleActivateTerminal}
          onBrowserUrlCommit={(url) => {
            writeBrowserUrl(workspacePath, browserId, url)
            setBrowserUrl(url)
          }}
          onOpenBrowser={viewerState.handleOpenBrowser}
          onOpenTerminal={viewerState.handleOpenTerminal}
          onResize={updateFilePaneShare}
          share={filePaneShare}
          terminalActive={viewerState.activeView?.kind === 'terminal'
            && viewerState.activeView.terminalId === terminalId}
          terminalId={terminalId}
          terminalOpen={viewerState.terminalOpen}
          onClose={viewerState.handleCloseFile}
          onCloseBrowser={viewerState.handleCloseBrowser}
          onCloseTerminal={viewerState.handleCloseTerminal}
          openPaths={viewerState.openFilePaths}
          workspacePath={workspacePath}
        />
      </main>

      <RightSidebar
        activeSessionId={selectedId}
        activeWidget={activeRightWidget}
        analysis={sessionAnalysis}
        analysisAvailable={analysisAvailable}
        currentQuotaProvider={currentQuotaProvider}
        onConversationNavigate={navigateToConversationTarget}
        onOpenBrowser={viewerState.handleOpenBrowser}
        onResize={updateRightSidebarWidth}
        sessionMessages={snapshot.messages}
        sessionMessagesAvailable={selectedSession !== undefined
          && snapshotSessionId === selectedSession.id}
        sessionRequestDurations={observedRequestDurations}
        quotas={quotas}
        environment={environment}
        shubAgentName={selectedShubAgentName}
        sessionCommands={snapshot.commands}
        sessionState={snapshot.state}
        sessionStats={snapshot.stats}
        width={rightSidebarWidth}
        workspacePath={workspacePath}
        onEnvironmentRefresh={() => refreshSessionEnvironment(selectedId)}
        onQuotaRefresh={() => refreshSessionQuotas(selectedId, false)}
        onQuotaReset={redeemQuotaReset}
        onWidgetSelect={(widget) =>
          setActiveRightWidget((current) => {
            const next = current === widget ? null : widget
            window.localStorage.setItem('pi-livecraft.right-sidebar-widget', next ?? 'none')
            return next
          })}
      />

      {questionnaire && !questionnaireInComposer && (
        <AskUserQuestionDialog
          canMinimize={false}
          key={String(
            questionnaire
              .request
              .id,
          )}
          dialog={questionnaire}
          sessionName={questionnaireSession?.name}
          onClose={() => closeDialog(questionnaire)}
          onError={(cause) => showToast('error', messageOf(cause))}
          onOpenSession={openQuestionnaireSession}
        />
      )}
      {visibleDialog && !questionnaire && (
        <ExtensionDialog
          dialog={visibleDialog}
          onClose={() => closeDialog(visibleDialog)}
          onError={(cause) => showToast('error', messageOf(cause))}
        />
      )}
      {commandPaletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          definitions={commandDefinitions}
          shortcuts={shortcuts}
          terminalCommand={terminalCommand}
          themes={allThemes(themePreferences)}
          activeThemeId={activeTheme.id}
          extensionSettings={extensionSettings}
          extensionSettingsError={extensionSettingsError}
          piSettings={piSettings}
          piSettingsError={piSettingsError}
          onExtensionSettingChange={changeExtensionSetting}
          onExtensionSettingsReload={loadExtensionSettings}
          onPiSettingChange={changePiSetting}
          onPiSettingsSaveDocument={savePiSettings}
          onPiSettingsReload={loadPiSettings}
          onChange={(id, shortcut) => {
            const next = { ...shortcuts, [id]: shortcut }
            setShortcuts(next)
            window.localStorage.setItem('pi-livecraft.shortcuts', JSON.stringify(next))
          }}
          onTerminalCommandChange={(value) => {
            setTerminalCommand(value)
            window.localStorage.setItem('pi-livecraft.terminal-command', value)
          }}
          onSelectTheme={selectTheme}
          onDuplicateTheme={duplicateActiveTheme}
          onRenameTheme={renameSelectedTheme}
          onUpdateThemeColor={updateSelectedThemeColor}
          onDeleteTheme={deleteSelectedTheme}
          onResetTheme={resetSelectedTheme}
          onReset={() => {
            setShortcuts(defaultShortcuts)
            window.localStorage.setItem('pi-livecraft.shortcuts', JSON.stringify(defaultShortcuts))
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

/** Lit une éventuelle ancienne liste invalide sans empêcher l'ouverture de l'application. */
function readShortcuts(): Partial<Record<CommandId, string>> {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem('pi-livecraft.shortcuts') ?? 'null',
    )
    if (!isObject(value)) return defaultShortcuts
    const primaryModifier = navigator.platform.toLowerCase().includes('mac') ? 'meta' : 'ctrl'
    const stored = Object
      .entries(value)
      .filter(([key, shortcut]) =>
        key !== 'send' && commandDefinitions.some((definition) => definition.id === key)
        && typeof shortcut === 'string'
      )
      .map(([key, shortcut]) => [key, migrateLegacyShortcut(shortcut as string, primaryModifier)])
    return { ...defaultShortcuts, ...Object.fromEntries(stored) } as Partial<
      Record<CommandId, string>
    >
  } catch {
    return defaultShortcuts
  }
}

function readTerminalCommand(): string {
  const stored = window.localStorage.getItem('pi-livecraft.terminal-command')
  return stored && stored.trim() && stored.includes('{cwd}') ? stored : ''
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function isManagerRuntimeStatus(value: unknown): value is ManagerRuntimeStatus {
  if (!isObject(value) || typeof value.canRestart !== 'boolean' || typeof value.state !== 'string')
    return false
  return value.state === 'checking' || value.state === 'current' || value.state === 'stale' || value
        .state === 'restarting'
    || value.state === 'disconnected' || value.state === 'unknown'
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export default App
