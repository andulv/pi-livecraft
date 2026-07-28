import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import { Tooltip } from './components/Tooltip.tsx'
import {
  commitChanges,
  createSession,
  discardChanges,
  getGitFileDiff,
  getGitSnapshot,
  getQuotas,
  improvePrompt,
  openExplorer,
  openSession,
  openTerminal,
  pushCommits,
  refreshQuotas,
  resetGitCommit,
  restartManager,
  revertGitCommit,
  sendPiCommand,
  subscribeManagerEvents,
} from './api.ts'
import { quotaRefreshAllowed } from '../shared/quota-refresh.ts'
import type {
  GitSnapshot,
  JsonObject,
  ManagerRuntimeStatus,
  QuotaSnapshot,
  SessionSummary,
} from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'
import { Composer } from './features/composer/Composer.tsx'
import { ToastStack, type Toast } from './features/notifications/ToastStack.tsx'
import { sessionActivity, type PiConnection } from './features/conversation/activity.ts'
import { Conversation } from './features/conversation/Conversation.tsx'
import { useConversationRuntime } from './features/conversation/useConversationRuntime.ts'
import { AskUserQuestionDialog, ExtensionDialog } from './features/dialogs/Dialogs.tsx'
import {
  isAgentSelector,
  isAskUserQuestionDialog,
  isBlockingDialog,
  type UiDialog,
} from './features/dialogs/dialog-protocol.ts'
import {
  clampRightSidebarWidth,
  isRightWidget,
  readRightSidebarWidth,
  type RightWidget,
} from './features/right-sidebar/right-sidebar.ts'
import { RightSidebar } from './features/right-sidebar/RightSidebar.tsx'
import { quotaProviderForModel } from './features/quotas/quota-display.ts'
import { DirectoryPicker } from './features/workspace/DirectoryPicker.tsx'
import { sidebarSessions } from './features/workspace/sidebar-sessions.ts'
import { useWorkspaceSessions } from './features/workspace/useWorkspaceSessions.ts'
import { WorkspaceSidebar } from './features/workspace/WorkspaceSidebar.tsx'
import { CommandPalette, type PaletteCommand } from './features/commands/CommandPalette.tsx'
import {
  commandDefinitions,
  defaultShortcuts,
  lastAssistantText,
  migrateLegacyShortcut,
  rightWidgetFromCommand,
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
  resolveActiveTheme,
  setActiveTheme,
  shadowForMode,
  updateThemeColor,
  type ThemeVariable,
} from './features/settings/themes.ts'
import {
  analyzeSession,
  type SessionAnalysisTarget,
} from './features/session-analysis/session-analysis.ts'
import './features/commands/commands.css'

interface AgentIntent {
  value?: string
}

const emptyAgentOptions: string[] = []
const conversationViewDetails = {
  simple: { label: 'Simplified view', description: 'Messages only, without tool calls' },
  detailed: { label: 'Detailed view', description: 'Visible calls with expandable preview' },
} as const
/** Orchestrates workspace state, Pi events, and UI panels. */
function App() {
  // Workspace and sessions
  const [compactingSessionIds, setCompactingSessionIds] = useState<ReadonlySet<string>>(new Set())

  // Conversation and Pi lifecycle
  const [piConnection, setPiConnection] = useState<PiConnection>('connecting')
  const [managerRuntimeStatus, setManagerRuntimeStatus] = useState<ManagerRuntimeStatus>({
    state: 'disconnected',
    canRestart: false,
  })
  const [conversationView, setConversationView] = useState<'detailed' | 'simple'>(() => {
    const stored = window.localStorage.getItem('pi-livecraft.conversation-view')
    if (stored === 'detailed' || stored === 'simple-expanded') return 'detailed'
    if (stored === 'simple') return 'simple'
    return window.localStorage.getItem('pi-livecraft.detailed-view') === 'false'
      ? 'simple'
      : 'detailed'
  })
  const conversationViewDetail = conversationViewDetails[conversationView]

  // Dialogs and notifications
  const [agentOptions, setAgentOptions] = useState<Record<string, string[]>>({})
  const [agentBusy, setAgentBusy] = useState<Record<string, boolean>>({})
  const [dialog, setDialog] = useState<UiDialog | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  // Workspace tools and right sidebar
  const [gitSnapshot, setGitSnapshot] = useState<GitSnapshot | null>(null)
  const [quotas, setQuotas] = useState<QuotaSnapshot | null>(null)
  const [activeRightWidget, setActiveRightWidget] = useState<RightWidget | null>(
    readActiveRightWidget,
  )
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readRightSidebarWidth(
      window.localStorage.getItem('pi-livecraft.right-sidebar-width') ?? window
        .localStorage
        .getItem('pi-livecraft.git-sidebar-width'),
    )
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
    { id: number; target: SessionAnalysisTarget }
  >()
  const [shortcuts, setShortcuts] = useState(() => readShortcuts())
  const [terminalCommand, setTerminalCommand] = useState(() => readTerminalCommand())

  // Workspace and session synchronization
  const selectedIdRef = useRef(window.localStorage.getItem('pi-livecraft.selected-session') ?? '')
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
  const gitRefreshVersionRef = useRef(0)
  const agentIntentsRef = useRef(new Map<string, AgentIntent>())
  const agentResponsesSentRef = useRef(new Set<string>())

  // Conversation timing and quotas
  const quotaAutoRefreshAtRef = useRef(new Map<string, number>())
  const quotasRef = useRef(quotas)
  quotasRef.current = quotas

  const dismissingRef = useRef(new Set<string>())

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
      setToasts((current) => [...current, toast])
      if (kind !== 'error') window.setTimeout(() => startDismissal(toast.id), 3000)
    },
    [startDismissal],
  )

  /** Removes a toast after explicit dismissal or automatic timeout. */
  const dismissToast = useCallback((id: string) => startDismissal(id), [startDismissal])

  /** Restores visible dialogs and resolves stale agent selectors that block manager restart. */
  const handleSessionsRefreshed = useCallback((nextSessions: SessionSummary[]): void => {
    // Restore user-facing dialogs (excludes agent selectors which are handled silently)
    const pending = nextSessions
      .flatMap((session) =>
        session.pendingUi.map((request) => ({ sessionId: session.id, request }))
      )
      .find(({ request }) => !isAgentSelector(request))
    setDialog((current) =>
      pending
        ?? (current && nextSessions.some(({ id }) => id === current.sessionId) ? current : null)
    )
    // Resolve stale agent selectors that were missed during an SSE disconnect
    for (const session of nextSessions) {
      for (const request of session.pendingUi) {
        if (!isAgentSelector(request)) continue
        const key = `${session.id}:${request.id}`
        if (agentResponsesSentRef.current.has(key)) continue
        agentResponsesSentRef.current.add(key)
        const intent = agentIntentsRef.current.get(session.id)
        const options = request.options.filter((o): o is string => typeof o === 'string')
        if (intent) {
          setAgentOptions((current) => ({ ...current, [session.id]: options }))
          agentIntentsRef.current.delete(session.id)
        }
        const selectedAgent = intent?.value && options.includes(intent.value)
          ? intent.value
          : undefined
        const response = selectedAgent ? { value: selectedAgent } : { cancelled: true }
        void sendPiCommand(session.id, {
          type: 'extension_ui_response',
          id: request.id,
          ...response,
        })
          .catch((cause) => {
            agentResponsesSentRef.current.delete(key)
            showToast('error', messageOf(cause))
          })
        if (intent?.value && !selectedAgent)
          showToast('error', 'Selected agent is no longer available.')
      }
    }
  }, [showToast])
  const handleWorkspaceSelected = useCallback((): void => {
    setGitSnapshot(null)
    setActiveRightWidget(null)
  }, [])
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
    completedSessionIds,
    creatingSession,
    directoryPickerOpen,
    isRefreshingSessions,
    markSessionCompleted,
    nameSessionFromFirstPrompt,
    recentSessions,
    recentWorkspacePaths,
    refreshSessions,
    removePendingRequest,
    renameSession,
    selectCreatedSession,
    selectedId,
    sentSessions,
    sessions,
    setDirectoryPickerOpen,
    setSelectedId,
    selectWorkspace,
    startAndSelectSession: startWorkspaceSession,
    updateSession,
    workspacePath,
  } = useWorkspaceSessions({
    onDraftMessage: handleSessionDraft,
    onError: handleWorkspaceError,
    onInitialMessageSent: handleInitialMessageSent,
    onSessionsRefreshed: handleSessionsRefreshed,
    onWorkspaceSelected: handleWorkspaceSelected,
  })
  selectedIdRef.current = selectedId

  const startAndSelectSession = useCallback(
    (start: () => Promise<SessionSummary>, initialMessage?: string, draftMessage?: string) =>
      startWorkspaceSession(start, { draftMessage, initialMessage }),
    [startWorkspaceSession],
  )

  const {
    activity,
    addOptimisticUserMessage,
    addPendingSteering,
    clearActivity,
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
  const model = isObject(snapshot.state?.model) ? snapshot.state.model : undefined
  const currentQuotaProvider = quotaProviderForModel(model?.provider)
  const currentQuotaProviderRef = useRef(currentQuotaProvider)
  currentQuotaProviderRef.current = currentQuotaProvider

  const visibleToasts = toasts.filter((toast) =>
    toast.sessionId === null || toast.sessionId === selectedId
  )

  // Right sidebar preferences
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
  /** Refreshes Git state for the current directory. Throws when requested so callers can handle the error. */
  const refreshGit = useCallback(async (cwd = workspacePath, notifyOnError = false) => {
    const version = ++gitRefreshVersionRef.current
    try {
      const nextSnapshot = await getGitSnapshot(cwd)
      if (version === gitRefreshVersionRef.current) setGitSnapshot(nextSnapshot)
    } catch (cause) {
      if (notifyOnError && version === gitRefreshVersionRef.current) throw cause
    }
  }, [workspacePath])

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

  /** Requests agent selection while avoiding concurrent requests for a session. */
  const requestAgent = useCallback((sessionId: string, value?: string) => {
    if (agentIntentsRef.current.has(sessionId)) return
    agentIntentsRef.current.set(sessionId, value ? { value } : {})
    setAgentBusy((current) => ({ ...current, [sessionId]: true }))
    void sendPiCommand(sessionId, { type: 'prompt', message: '/agent' })
      .then(() => refreshSnapshot(sessionId))
      .catch((cause) => {
        agentIntentsRef.current.delete(sessionId)
        showToast('error', messageOf(cause))
      })
      .finally(() => setAgentBusy((current) => ({ ...current, [sessionId]: false })))
  }, [refreshSnapshot, showToast])

  // Initial application synchronization
  useEffect(() => void refreshGit(), [refreshGit])
  useEffect(() => {
    void getQuotas().then(setQuotas).catch(() => undefined)
  }, [])

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
      if (event.type === 'tool_execution_end') void refreshGit()
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
        event.type === 'extension_ui_request' && isBlockingDialog(event) && !isAgentSelector(event)
      ) {
        if (typeof event.id === 'string') addPendingRequest(sessionId, event)
        if (sessionId === selectedIdRef.current) clearActivity()
      }
      if (event.type === 'extension_ui_request') {
        if (
          event.method === 'notify' || (event.method === 'setStatus' && event.statusKey === 'agent')
        ) selectCreatedSession(sessionId)
        if (event.method === 'notify' && typeof event.message === 'string')
          showToast('notice', event.message, sessionId)
        const agentIntent = agentIntentsRef.current.get(sessionId)
        if (isAgentSelector(event)) {
          const options = event.options.filter((option): option is string =>
            typeof option === 'string'
          )
          if (agentIntent) {
            setAgentOptions((current) => ({ ...current, [sessionId]: options }))
            agentIntentsRef.current.delete(sessionId)
          }
          const selectedAgent = agentIntent?.value && options.includes(agentIntent.value)
            ? agentIntent.value
            : undefined
          const response = selectedAgent ? { value: selectedAgent } : { cancelled: true }
          void sendPiCommand(sessionId, {
            type: 'extension_ui_response',
            id: event.id,
            ...response,
          })
            .then(() => refreshSnapshot(sessionId))
            .catch((cause) => showToast('error', messageOf(cause)))
          if (agentIntent?.value && !selectedAgent)
            showToast(
              'error',
              'Selected agent is no longer available.',
            )
          return
        }
        if (isBlockingDialog(event)) setDialog({ sessionId, request: event })
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
      handlePiEvent,
      markSessionCompleted,
      refreshGit,
      refreshSessionQuotas,
      refreshSnapshot,
      renameSession,
      selectCreatedSession,
      showToast,
      updateSession,
    ],
  )
  replayPiEventRef.current = handleManagerPiEvent

  useEffect(() =>
    subscribeManagerEvents((managerEvent) => {
      if (
        managerEvent.event === 'manager_connected' || managerEvent.event === 'manager_disconnected'
      ) {
        setPiConnection(managerEvent.event === 'manager_connected' ? 'connected' : 'disconnected')
        clearActivity()
      }
      if (managerEvent.event === 'manager_status' && isManagerRuntimeStatus(managerEvent.data))
        setManagerRuntimeStatus(managerEvent.data)
      if (
        managerEvent.event === 'manager_connected' || managerEvent.event === 'session_created'
        || managerEvent.event === 'session_exited'
      ) void refreshSessions()
      if (managerEvent.event === 'pi' && isObject(managerEvent.data))
        handleManagerPiEvent(
          managerEvent.sessionId,
          managerEvent.data,
          managerEvent.sequence,
        )
    }, () => {
      resetEventSequence()
      setPiConnection('connecting')
      clearActivity()
      showToast('error', 'Connection to backend lost; retrying.')
    }), [clearActivity, handleManagerPiEvent, refreshSessions, resetEventSequence, showToast])

  // Agent capabilities
  useEffect(() => {
    const exposesAgentCommand = snapshot.commands.some((command) => command.name === 'agent')
    if (
      snapshotSessionId === selectedId && exposesAgentCommand && !agentOptions[selectedId]
      && !agentBusy[selectedId]
    ) {
      requestAgent(selectedId)
    }
  }, [agentBusy, agentOptions, requestAgent, selectedId, snapshot.commands, snapshotSessionId])

  // Selected session and loading state
  const selectedSession = sessions.find((session) => session.id === selectedId)
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
    (agent: string) => requestAgent(selectedId, agent),
    [requestAgent, selectedId],
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
    async (message: string, images: JsonObject[], behavior: 'steer' | 'followUp') => {
      const command: JsonObject = { type: 'prompt', message, images }
      const isSteering = selectedSessionStatus === 'running' && behavior === 'steer'
      if (selectedSessionStatus === 'running') command.streamingBehavior = behavior
      if (isSteering) addPendingSteering(message)
      const optimisticId = !isSteering ? addOptimisticUserMessage(message) : undefined
      try {
        await sendPiCommand(selectedId, command)
        const sentSession = sessions.find((session) => session.id === selectedId)
        const shouldNameSession = sentSession?.name === 'Nouvelle session' && !snapshot
          .messages
          .some((entry) => entry.role === 'user')
        if (sentSession && shouldNameSession) nameSessionFromFirstPrompt(sentSession, message)
        await refreshSessions()
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
      nameSessionFromFirstPrompt,
      refreshSessions,
      removeLiveMessage,
      removePendingSteering,
      selectedId,
      selectedSessionStatus,
      sessions,
      snapshot.messages,
    ],
  )
  const handleComposerAbort = useCallback(() => sendPiCommand(selectedId, { type: 'abort' }), [
    selectedId,
  ])
  const handlePromptImprovement = useCallback(
    (prompt: string, direction?: string) => improvePrompt(selectedId, prompt, direction),
    [selectedId],
  )
  const handleComposerSelectOpened = useCallback(() => setRequestedSelect(null), [])
  const sessionAnalysis = useMemo(() =>
    selectedSession && snapshotSessionId === selectedSession.id
      ? analyzeSession(snapshot.messages, snapshot.stats, selectedSession.status === 'running', {
        requestDurations: observedRequestDurations,
        toolDurations: observedToolDurations,
        toolExecutions,
      })
      : null, [
    observedRequestDurations,
    observedToolDurations,
    selectedSession,
    snapshot.messages,
    snapshot.stats,
    snapshotSessionId,
    toolExecutions,
  ])
  const questionnaire = dialog && isAskUserQuestionDialog(dialog.request) ? dialog : null
  const questionnaireInComposer = questionnaire?.sessionId === selectedId
    && snapshotSessionId === selectedId

  const handleContextSessionStart = useCallback(
    (draft: string) => startAndSelectSession(() => createSession(workspacePath), undefined, draft),
    [startAndSelectSession, workspacePath],
  )

  const markComposerDraftApplied = useCallback((id: string) => {
    setComposerDraftRequest((current) => current?.id === id ? undefined : current)
  }, [])

  // Commands and keyboard shortcuts
  /** Executes a productivity command in the context of the active session. */
  const executeCommand = useCallback((id: CommandId): void => {
    const rightWidget = rightWidgetFromCommand(id)
    if (rightWidget) {
      if (
        (rightWidget === 'analysis' && !sessionAnalysis)
        || (rightWidget === 'git' && !gitSnapshot?.repository)
      ) return
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
    if (id === 'new-session') {
      void startAndSelectSession(() => createSession(workspacePath)).catch((cause) =>
        showToast('error', messageOf(cause))
      )
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
      setDirectoryPickerOpen(true)
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
        const next = current === 'simple' ? 'detailed' : 'simple'
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
    gitSnapshot?.repository,
    openRightWidget,
    recentSessions,
    recentWorkspacePaths,
    selectWorkspace,
    selectedId,
    sentSessions,
    sessionAnalysis,
    setDirectoryPickerOpen,
    setSelectedId,
    showToast,
    snapshot.messages,
    startAndSelectSession,
    terminalCommand,
    workspacePath,
  ])

  const paletteCommands: PaletteCommand[] = useMemo(() => {
    const visibleIds = sidebarSessions(recentSessions, workspacePath, sentSessions).map((session) =>
      session.id
    )
    const selectedIndex = selectedId ? visibleIds.indexOf(selectedId) : -1
    return commandDefinitions.map((definition) => {
      const rightWidget = rightWidgetFromCommand(definition.id)
      const unavailableWidget = (rightWidget === 'analysis' && !sessionAnalysis)
        || (rightWidget === 'git' && !gitSnapshot?.repository)
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
    gitSnapshot?.repository,
    recentSessions,
    recentWorkspacePaths,
    selectedId,
    selectedSession,
    sentSessions,
    sessionAnalysis,
    shortcuts,
    workspacePath,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const target = event.target
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
        event.key === 'Escape' && (commandPaletteOpen || settingsOpen || dialog || document
          .querySelector('.composer-select-content,[data-radix-select-content],.slash-commands'))
      ) return
      event.preventDefault()
      executeCommand(command)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commandPaletteOpen, dialog, executeCommand, settingsOpen, shortcuts])

  /** Positions the conversation on the element chosen from session analysis. */
  const navigateToAnalysisTarget = useCallback((target: SessionAnalysisTarget): void => {
    if (target.kind === 'tool' || target.kind === 'turn') {
      setConversationView('detailed')
      window.localStorage.setItem('pi-livecraft.conversation-view', 'detailed')
    }
    setConversationNavigation((current) => ({ id: (current?.id ?? 0) + 1, target }))
  }, [])

  // Right sidebar composition
  /** Actions pinned to the right rail without an associated panel. */
  const railActions = useMemo(() => [
    {
      key: 'explorer',
      icon: (
        <svg aria-hidden='true' viewBox='0 0 24 24' width='18' height='18'>
          <path
            d='M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2h7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='1.8'
          />
          <path
            d='M3 9h18'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='1.8'
          />
        </svg>
      ),
      label: 'Open folder',
      onClick: () => {
        void openExplorer(workspacePath).catch((cause) => showToast('error', messageOf(cause)))
      },
    },
    {
      key: 'terminal',
      icon: <span aria-hidden='true'>›_</span>,
      label: 'Open terminal',
      onClick: () => {
        void openTerminal(workspacePath, terminalCommand).catch((cause) =>
          showToast('error', messageOf(cause))
        )
      },
    },
  ], [showToast, terminalCommand, workspacePath])

  // Application layout
  const rightPanelVisible = activeRightWidget === 'todo' || activeRightWidget === 'quotas'
    || (activeRightWidget === 'analysis' && sessionAnalysis !== null)
    || (activeRightWidget === 'git' && gitSnapshot?.repository === true)

  return (
    <div
      className={`app-shell ${
        rightPanelVisible ? 'right-sidebar-visible' : 'right-sidebar-collapsed'
      }`}
      style={{ '--right-sidebar-width': `${rightSidebarWidth}px` } as CSSProperties}
    >
      <WorkspaceSidebar
        compactingSessionIds={compactingSessionIds}
        completedSessionIds={completedSessionIds}
        isRefreshing={isRefreshingSessions}
        recentSessions={recentSessions}
        sentSessions={sentSessions}
        sessions={sessions}
        selectedId={selectedId}
        workspacePath={workspacePath}
        onChooseWorkspace={() => setDirectoryPickerOpen(true)}
        onCreate={() => startAndSelectSession(() => createSession(workspacePath))}
        onOpenSession={(recentSession) =>
          startAndSelectSession(() => openSession(workspacePath, recentSession.sessionPath))}
        onSelectOtherWorkspaceSession={(session) => selectWorkspace(session.cwd, session.id)}
        onSelectSession={setSelectedId}
        onError={(cause) => showToast('error', messageOf(cause))}
        onOpenSettings={() => setSettingsOpen(true)}
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
              {(snapshotSessionId === selectedSession.id || loadingPhase === 'exiting') && (
                <>
                  <Conversation
                    activity={displayedActivity}
                    agentName={selectedSession.activeAgent}
                    darkMode={activeTheme.mode === 'dark'}
                    detailedView={conversationView === 'detailed'}
                    key={selectedSession.id}
                    liveMessages={liveMessages}
                    messages={snapshot.messages}
                    navigationRequest={conversationNavigation}
                    onError={handleConversationError}
                    onStartSession={handleContextSessionStart}
                    pendingSteering={pendingSteering}
                    repositoryRoot={gitSnapshot?.root}
                    scrollToBottomRequest={scrollToBottomRequest}
                    toolExecutions={toolExecutions}
                    workspacePath={workspacePath}
                  />
                  <Tooltip
                    label={`${conversationViewDetail.label} — ${conversationViewDetail.description}`}
                  >
                    <button
                      aria-label={`${conversationViewDetail.label}. ${conversationViewDetail.description}. Click to toggle view.`}
                      className={`chat-detail-toggle ${conversationView}`}
                      onClick={() =>
                        setConversationView((current) => {
                          const next = current === 'simple' ? 'detailed' : 'simple'
                          window.localStorage.setItem('pi-livecraft.conversation-view', next)
                          return next
                        })}
                      type='button'
                    >
                      <span aria-hidden='true' className='chat-detail-toggle-icon'>⌘</span>
                      <span className='chat-detail-toggle-copy'>
                        <strong>{conversationViewDetail.label}</strong>
                        <small>{conversationViewDetail.description}</small>
                      </span>
                    </button>
                  </Tooltip>
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
                      selectedAgent={selectedSession.activeAgent ?? ''}
                      onAgentChange={handleComposerAgentChange}
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
                      compacting={displayedActivity?.kind === 'compacting'}
                      onSend={handleComposerSend}
                      onAbort={handleComposerAbort}
                      onImprovePrompt={handlePromptImprovement}
                      onError={handleConversationError}
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
                <h1>Control Pi from your browser</h1>
                <p>Create a local session to access your models, agents, tools, and commands.</p>
              </section>
              <ToastStack onDismiss={dismissToast} standalone toasts={visibleToasts} />
            </>
          )}
      </main>

      <RightSidebar
        activeWidget={activeRightWidget}
        analysis={sessionAnalysis}
        currentQuotaProvider={currentQuotaProvider}
        onAnalysisNavigate={navigateToAnalysisTarget}
        onResize={updateRightSidebarWidth}
        snapshot={gitSnapshot?.repository ? gitSnapshot : null}
        quotas={quotas}
        width={rightSidebarWidth}
        workspacePath={workspacePath}
        railActions={railActions}
        onCommit={async (message) => {
          await commitChanges(workspacePath, message)
        }}
        onDiscard={async (path) => {
          await discardChanges(workspacePath, path)
        }}
        onPush={() => pushCommits(workspacePath)}
        onFileSelect={(path, commitHash) => getGitFileDiff(workspacePath, path, commitHash)}
        onQuotaRefresh={() => refreshSessionQuotas(selectedId, false)}
        onRefresh={() => refreshGit(workspacePath, true)}
        onReset={async (hash) => {
          return await resetGitCommit(workspacePath, hash)
        }}
        onRevert={async (hash) => {
          return await revertGitCommit(workspacePath, hash)
        }}
        onTodoSendPrompt={(message) =>
          startAndSelectSession(() => createSession(workspacePath), message)}
        onTodoStartSession={(message) =>
          startAndSelectSession(() => createSession(workspacePath), undefined, message)}
        onWidgetSelect={(widget) =>
          setActiveRightWidget((current) => {
            const next = current === widget ? null : widget
            window.localStorage.setItem('pi-livecraft.right-sidebar-widget', next ?? 'none')
            return next
          })}
      />

      {directoryPickerOpen && (
        <DirectoryPicker
          initialPath={workspacePath}
          recentPaths={recentWorkspacePaths}
          onClose={() => setDirectoryPickerOpen(false)}
          onError={(cause) => showToast('error', messageOf(cause))}
          onSelect={selectWorkspace}
        />
      )}
      {questionnaire && !questionnaireInComposer && (
        <AskUserQuestionDialog
          canMinimize={false}
          key={String(
            questionnaire
              .request
              .id,
          )}
          dialog={questionnaire}
          sessionName={sessions
            .find((session) => session.id === questionnaire.sessionId)
            ?.name}
          onClose={() => closeDialog(questionnaire)}
          onError={(cause) => showToast('error', messageOf(cause))}
        />
      )}
      {dialog && !questionnaire && (
        <ExtensionDialog
          dialog={dialog}
          onClose={() => closeDialog(dialog)}
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

/** Restores the last-selected right sidebar widget, falling back to git when not collapsed. */
function readActiveRightWidget(): RightWidget | null {
  const stored = window.localStorage.getItem('pi-livecraft.right-sidebar-widget')
  if (isRightWidget(stored)) return stored
  if (stored === 'none') return null
  return window.localStorage.getItem('pi-livecraft.git-sidebar-collapsed') === 'true' ? null : 'git'
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
