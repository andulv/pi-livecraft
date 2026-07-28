import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import { Tooltip } from './components/Tooltip.tsx'
import { commitChanges, createSession, discardChanges, getGitFileDiff, getGitSnapshot, getQuotas, getSnapshot, improvePrompt, listDirectories, listRecentSessions, listSessions, openExplorer, openSession, openTerminal, pushCommits, refreshQuotas, resetGitCommit, restartManager, revertGitCommit, sendPiCommand } from './api.ts'
import { quotaRefreshAllowed } from '../shared/quota-refresh.ts'
import type { GitSnapshot, JsonObject, ManagerEvent, ManagerRuntimeStatus, QuotaSnapshot, RecentSession, SessionSnapshot, SessionSummary } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'
import { Composer } from './features/composer/Composer.tsx'
import { promptSessionTitle } from './features/composer/prompt-title.ts'
import { ToastStack, type Toast } from './features/notifications/ToastStack.tsx'
import { activityForPiEvent, sessionActivity, type Activity, type PiConnection } from './features/conversation/activity.ts'
import { Conversation } from './features/conversation/Conversation.tsx'
import { applyToolCallUpdate, applyToolExecutionUpdate, interruptToolCallGeneration, toolCallInUpdate, toolExecutionUpdateInEvent, type LiveMessage, type ToolExecution, type ToolResult } from './features/conversation/tool-calls.ts'
import { AskUserQuestionDialog, ExtensionDialog } from './features/dialogs/Dialogs.tsx'
import { isAgentSelector, isAskUserQuestionDialog, isBlockingDialog, type UiDialog } from './features/dialogs/dialog-protocol.ts'
import { clampRightSidebarWidth, isRightWidget, readRightSidebarWidth, type RightWidget } from './features/right-sidebar/right-sidebar.ts'
import { RightSidebar } from './features/right-sidebar/RightSidebar.tsx'
import { quotaProviderForModel } from './features/quotas/quota-display.ts'
import { DirectoryPicker } from './features/workspace/DirectoryPicker.tsx'
import { recentWorkspaces } from './features/workspace/recent-workspaces.ts'
import { pickSessionOnOpen, sidebarSessions } from './features/workspace/sidebar-sessions.ts'
import { WorkspaceSidebar } from './features/workspace/WorkspaceSidebar.tsx'
import { CommandPalette, type PaletteCommand } from './features/commands/CommandPalette.tsx'
import { commandDefinitions, defaultShortcuts, lastAssistantText, migrateLegacyShortcut, rightWidgetFromCommand, shortcutFromEvent, type CommandId } from './features/commands/command-registry.ts'
import { SettingsPanel } from './features/settings/SettingsPanel.tsx'
import { ManagerRuntimeNotice } from './features/manager/ManagerRuntimeNotice.tsx'
import { allThemes, applyThemePalette, deleteTheme, duplicateTheme, persistThemePreferences, readThemePreferences, renameTheme, resolveActiveTheme, setActiveTheme, shadowForMode, updateThemeColor, type ThemeVariable } from './features/settings/themes.ts'
import { analyzeSession, type SessionAnalysisTarget } from './features/session-analysis/session-analysis.ts'
import './features/commands/commands.css'

interface AgentIntent {
  value?: string
}

const emptySnapshot: SessionSnapshot = { state: null, messages: [], models: [], commands: [], stats: null }
const emptyAgentOptions: string[] = []
const conversationViewDetails = {
  simple: { label: 'Simplified view', description: 'Messages only, without tool calls' },
  detailed: { label: 'Detailed view', description: 'Visible calls with expandable preview' },
} as const
/** Orchestrates workspace state, Pi events, and UI panels. */
function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])
  const [sentSessions, setSentSessions] = useState<RecentSession[]>([])
  const [completedSessionIds, setCompletedSessionIds] = useState<ReadonlySet<string>>(() => readCompletedSessionIds())
  const [compactingSessionIds, setCompactingSessionIds] = useState<ReadonlySet<string>>(new Set())
  const [workspacePath, setWorkspacePath] = useState(() => window.localStorage.getItem('pi-livecraft.workspace-path') ?? '.')
  const [recentWorkspacePaths, setRecentWorkspacePaths] = useState(() => recentWorkspaces(window.localStorage.getItem('pi-livecraft.workspace-path') ?? '.', readRecentWorkspaces()))
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(() => window.localStorage.getItem('pi-livecraft.selected-session') ?? '')
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(emptySnapshot)
  const [snapshotSessionId, setSnapshotSessionId] = useState('')
  const [liveMessages, setLiveMessages] = useState<LiveMessage[]>([])
  const [pendingSteering, setPendingSteering] = useState<string[]>([])
  const [activity, setActivity] = useState<Activity | null>(null)
  const [piConnection, setPiConnection] = useState<PiConnection>('connecting')
  const [managerRuntimeStatus, setManagerRuntimeStatus] = useState<ManagerRuntimeStatus>({ state: 'disconnected', canRestart: false })
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([])
  const [conversationView, setConversationView] = useState<'detailed' | 'simple'>(() => {
    const stored = window.localStorage.getItem('pi-livecraft.conversation-view')
    if (stored === 'detailed' || stored === 'simple-expanded') return 'detailed'
    return window.localStorage.getItem('pi-livecraft.detailed-view') === 'true' ? 'detailed' : 'simple'
  })
  const conversationViewDetail = conversationViewDetails[conversationView]
  const [agentOptions, setAgentOptions] = useState<Record<string, string[]>>({})
  const [agentBusy, setAgentBusy] = useState<Record<string, boolean>>({})
  const [dialog, setDialog] = useState<UiDialog | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [gitSnapshot, setGitSnapshot] = useState<GitSnapshot | null>(null)
  const [quotas, setQuotas] = useState<QuotaSnapshot | null>(null)
  const [activeRightWidget, setActiveRightWidget] = useState<RightWidget | null>(readActiveRightWidget)
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => readRightSidebarWidth(window.localStorage.getItem('pi-livecraft.right-sidebar-width') ?? window.localStorage.getItem('pi-livecraft.git-sidebar-width')))
  const [themePreferences, setThemePreferences] = useState(() => readThemePreferences())
  const activeTheme = useMemo(() => resolveActiveTheme(themePreferences), [themePreferences])
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  type LoadingPhase = 'hidden' | 'entering' | 'visible' | 'exiting'
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('hidden')
  const [requestedSelect, setRequestedSelect] = useState<'agent' | 'model' | 'thinking' | null>(null)
  const [submitRequest, setSubmitRequest] = useState(0)
  const [focusComposerRequest, setFocusComposerRequest] = useState(0)
  const [composerDraftRequest, setComposerDraftRequest] = useState<{ id: string; message: string; sessionId: string }>()
  const [scrollToBottomRequest, setScrollToBottomRequest] = useState(0)
  const [conversationNavigation, setConversationNavigation] = useState<{ id: number; target: SessionAnalysisTarget }>()
  const [observedToolDurations, setObservedToolDurations] = useState<ReadonlyMap<string, number>>(new Map())
  const [observedRequestDurations, setObservedRequestDurations] = useState<ReadonlyMap<number, number>>(new Map())
  const [observedTurnDurations, setObservedTurnDurations] = useState<ReadonlyMap<number, number>>(new Map())
  const [shortcuts, setShortcuts] = useState(() => readShortcuts())
  const [terminalCommand, setTerminalCommand] = useState(() => readTerminalCommand())
  const selectedIdRef = useRef(selectedId)
  const sessionsRef = useRef(sessions)
  const sentSessionsRef = useRef(sentSessions)
  const completedSessionIdsRef = useRef(completedSessionIds)
  const creatingSessionRef = useRef(false)
  const refreshVersionRef = useRef(0)
  const snapshotRefreshVersionRef = useRef(0)
  const loadingTimerRef = useRef<number>(0)
  const gitRefreshVersionRef = useRef(0)
  const agentIntentsRef = useRef(new Map<string, AgentIntent>())
  const toolStartedAtRef = useRef(new Map<string, number>())
  const turnMessageStartedAtRef = useRef(new Map<number, number>())
  const turnMessageSeqRef = useRef(0)
  const requestStartedAtRef = useRef<number | undefined>(undefined)
  const queueUpdateVersionRef = useRef(0)
  const liveMessagesRef = useRef<LiveMessage[]>([])
  const liveMessageIndexRef = useRef(-1)
  const pendingLiveMessagesRef = useRef<LiveMessage[] | undefined>(undefined)
  const liveUpdateFrameRef = useRef<number | undefined>(undefined)
  const quotaAutoRefreshAtRef = useRef(new Map<string, number>())
  const autoSelectOnRefreshRef = useRef(true)
  const quotasRef = useRef(quotas)
  const model = isObject(snapshot.state?.model) ? snapshot.state.model : undefined
  const currentQuotaProvider = quotaProviderForModel(model?.provider)
  const currentQuotaProviderRef = useRef(currentQuotaProvider)
  selectedIdRef.current = selectedId
  sessionsRef.current = sessions
  sentSessionsRef.current = sentSessions
  completedSessionIdsRef.current = completedSessionIds
  quotasRef.current = quotas
  currentQuotaProviderRef.current = currentQuotaProvider

  const dismissingRef = useRef(new Set<string>())

  /** Marks a toast as dismissing, then removes it after the exit animation. */
  const startDismissal = useCallback((id: string) => {
    if (dismissingRef.current.has(id)) return
    dismissingRef.current.add(id)
    setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, dismissing: true } : toast))
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
      dismissingRef.current.delete(id)
    }, 160)
  }, [])

  const showToast = useCallback((kind: Toast['kind'], message: string, sessionId: string | null = selectedIdRef.current) => {
    const toast = { id: crypto.randomUUID(), kind, message, sessionId }
    setToasts((current) => [...current, toast])
    if (kind !== 'error') window.setTimeout(() => startDismissal(toast.id), 3000)
  }, [startDismissal])

  /** Removes a toast after explicit dismissal or automatic timeout. */
  const dismissToast = useCallback((id: string) => startDismissal(id), [startDismissal])

  const visibleToasts = toasts.filter((toast) => toast.sessionId === null || toast.sessionId === selectedId)

  /** Applies the latest streamed assistant messages at most once per rendered frame. */
  const flushLiveUpdates = useCallback(() => {
    if (liveUpdateFrameRef.current !== undefined) window.cancelAnimationFrame(liveUpdateFrameRef.current)
    liveUpdateFrameRef.current = undefined
    const pending = pendingLiveMessagesRef.current
    pendingLiveMessagesRef.current = undefined
    if (pending) {
      liveMessagesRef.current = pending
      setLiveMessages(pending)
    }
  }, [])

  /** Queues a complete public-RPC assistant message without rendering every SSE delta. */
  const queueLiveMessage = useCallback((message: JsonObject) => {
    const index = liveMessageIndexRef.current
    if (index < 0) return
    const next = [...(pendingLiveMessagesRef.current ?? liveMessagesRef.current)]
    next[index] = { ...next[index], message }
    pendingLiveMessagesRef.current = next
    if (liveUpdateFrameRef.current !== undefined) return
    liveUpdateFrameRef.current = window.requestAnimationFrame(flushLiveUpdates)
  }, [flushLiveUpdates])

  /** Clears streamed assistant messages when the displayed session changes. */
  const clearLiveMessages = useCallback(() => {
    if (liveUpdateFrameRef.current !== undefined) window.cancelAnimationFrame(liveUpdateFrameRef.current)
    liveUpdateFrameRef.current = undefined
    pendingLiveMessagesRef.current = undefined
    liveMessagesRef.current = []
    liveMessageIndexRef.current = -1
    setLiveMessages([])
  }, [])

  const updateRightSidebarWidth = useCallback((width: number) => {
    const nextWidth = clampRightSidebarWidth(width)
    window.localStorage.setItem('pi-livecraft.right-sidebar-width', String(nextWidth))
    setRightSidebarWidth(nextWidth)
  }, [])

  const openRightWidget = useCallback((widget: RightWidget) => {
    window.localStorage.setItem('pi-livecraft.right-sidebar-widget', widget)
    setActiveRightWidget(widget)
  }, [])

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

  const updateSelectedThemeColor = useCallback((id: string, variable: ThemeVariable, color: string) => {
    setThemePreferences((current) => updateThemeColor(current, id, variable, color))
  }, [])

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

  useEffect(() => {
    if (window.localStorage.getItem('pi-livecraft.workspace-path') !== null) return
    let active = true
    void listDirectories('.').then(({ path }) => {
      if (!active || window.localStorage.getItem('pi-livecraft.workspace-path') !== null) return
      setWorkspacePath(path)
      setRecentWorkspacePaths(recentWorkspaces(path, readRecentWorkspaces()))
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (selectedId) window.localStorage.setItem('pi-livecraft.selected-session', selectedId)
    else window.localStorage.removeItem('pi-livecraft.selected-session')
    setCompletedSessionIds((current) => {
      const sessionKey = sessionsRef.current.find((session) => session.id === selectedId)?.sessionPath ?? selectedId
      if (!current.has(sessionKey)) return current
      const next = new Set(current)
      next.delete(sessionKey)
      return next
    })
  }, [selectedId])

  useEffect(() => {
    writeCompletedSessionIds(completedSessionIds)
  }, [completedSessionIds])

  /** Reloads sessions and their UI requests while discarding stale responses. */
  const refreshSessions = useCallback(async (cwd = workspacePath) => {
    const version = ++refreshVersionRef.current
    const shouldAutoSelect = autoSelectOnRefreshRef.current
    try {
      const [nextSessions, nextRecentSessions] = await Promise.all([listSessions(), listRecentSessions(cwd)])
      if (version !== refreshVersionRef.current) return
      const autoSelectId = shouldAutoSelect
        ? pickSessionOnOpen(sidebarSessions(nextRecentSessions, cwd, sentSessionsRef.current), nextSessions, completedSessionIdsRef.current)
        : undefined
      setSessions(nextSessions)
      setCompletedSessionIds((current) => {
        if (current.size === 0) return current
        const sessionKeys = new Set(nextSessions.flatMap((session) => [session.id, session.sessionPath].filter((key): key is string => Boolean(key))))
        const recentKeys = new Set(nextRecentSessions.map((session) => session.sessionPath))
        const next = new Set([...current].filter((key) => sessionKeys.has(key) || recentKeys.has(key)))
        return next.size === current.size ? current : next
      })
      setRecentSessions(nextRecentSessions)
      setSentSessions((current) => current.filter((sent) => !nextRecentSessions.some((recent) => recent.id === sent.id || recent.sessionPath === sent.sessionPath)))
      if (shouldAutoSelect) {
        autoSelectOnRefreshRef.current = false
        setSelectedId(autoSelectId ?? '')
      } else {
        setSelectedId((current) => nextSessions.some((session) => session.id === current) ? current : '')
      }
      const pending = nextSessions.flatMap((session) =>
        session.pendingUi.map((request) => ({ sessionId: session.id, request })),
      ).find(({ request }) => !isAgentSelector(request))
      setDialog((current) => pending ?? (current && nextSessions.some(({ id }) => id === current.sessionId) ? current : null))
    } catch (cause) {
      if (version === refreshVersionRef.current) showToast('error', messageOf(cause))
    }
  }, [showToast, workspacePath])

  /** Selects a workspace, optionally preserving an explicit session over automatic selection. */
  const selectWorkspace = useCallback((path: string, targetSessionId?: string): void => {
    window.localStorage.setItem('pi-livecraft.workspace-path', path)
    const nextRecentWorkspacePaths = recentWorkspaces(path, recentWorkspacePaths)
    window.localStorage.setItem('pi-livecraft.recent-workspace-paths', JSON.stringify(nextRecentWorkspacePaths))
    setRecentWorkspacePaths(nextRecentWorkspacePaths)
    setGitSnapshot(null)
    setActiveRightWidget(null)
    setWorkspacePath(path)
    setSelectedId(targetSessionId ?? '')
    setDirectoryPickerOpen(false)
    autoSelectOnRefreshRef.current = targetSessionId === undefined
    void refreshSessions(path)
  }, [recentWorkspacePaths, refreshSessions])

  /** Clears an answered request immediately, then reconciles all pending requests with the manager. */
  const closeDialog = useCallback((closedDialog: UiDialog) => {
    const requestId = closedDialog.request.id
    setDialog((current) => current?.sessionId === closedDialog.sessionId && current.request.id === requestId ? null : current)
    if (typeof requestId === 'string') {
      setSessions((current) => current.map((session) => session.id === closedDialog.sessionId
        ? { ...session, pendingUi: session.pendingUi.filter((request) => request.id !== requestId) }
        : session))
    }
    void refreshSessions()
  }, [refreshSessions])

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

  /** Synchronizes the session snapshot and reconciles streamed assistant messages. */
  const refreshSnapshot = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      setSnapshot(emptySnapshot)
      setSnapshotSessionId('')
      return
    }
    const version = ++snapshotRefreshVersionRef.current
    const targetSessionId = sessionId
    try {
      const nextSnapshot = await getSnapshot(sessionId)
      if (version !== snapshotRefreshVersionRef.current || targetSessionId !== selectedIdRef.current) return nextSnapshot
      flushLiveUpdates()
      setSnapshot(nextSnapshot)
      setSnapshotSessionId(sessionId)
      return nextSnapshot
    } catch (cause) {
      if (version === snapshotRefreshVersionRef.current && targetSessionId === selectedIdRef.current) showToast('error', messageOf(cause))
    }
  }, [flushLiveUpdates, showToast])

  /** Refreshes quotas, allowing manual clicks to bypass automatic throttling. */
  const refreshSessionQuotas = useCallback(async (sessionId: string, automatic: boolean): Promise<void> => {
    if (!sessionId) throw new Error('An open Pi session is required to refresh quotas.')
    if (automatic) {
      const provider = currentQuotaProviderRef.current
      if (!provider) return
      const lastRefreshAt = Math.max(quotasRef.current?.[provider].updatedAt ?? 0, quotaAutoRefreshAtRef.current.get(sessionId) ?? 0)
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
  }, [showToast])

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

  useEffect(() => void refreshSessions(), [refreshSessions])
  useEffect(() => void refreshGit(), [refreshGit])
  useEffect(() => { void getQuotas().then(setQuotas).catch(() => undefined) }, [])
  useEffect(() => {
    clearLiveMessages()
    setSnapshot(emptySnapshot)
    setSnapshotSessionId('')
    setPendingSteering([])
    queueUpdateVersionRef.current += 1
    setActivity(null)
    setToolExecutions([])
    setConversationNavigation(undefined)
    setObservedToolDurations(new Map())
    setObservedRequestDurations(new Map())
    setObservedTurnDurations(new Map())
    toolStartedAtRef.current.clear()
    turnMessageStartedAtRef.current.clear()
    turnMessageSeqRef.current = 0
    requestStartedAtRef.current = undefined
    void refreshSnapshot(selectedId)
  }, [clearLiveMessages, refreshSnapshot, selectedId])

  useEffect(() => {
    const events = new EventSource('/api/events')
    events.onmessage = ({ data }) => {
      const event: unknown = JSON.parse(data)
      if (!isManagerEvent(event)) return
      if (event.event === 'manager_connected' || event.event === 'manager_disconnected') {
        setPiConnection(event.event === 'manager_connected' ? 'connected' : 'disconnected')
        setActivity(null)
      }
      if (event.event === 'manager_status' && isManagerRuntimeStatus(event.data)) setManagerRuntimeStatus(event.data)
      if (event.event === 'manager_connected' || event.event === 'session_created' || event.event === 'session_exited') void refreshSessions()
      if (event.event !== 'pi' || !isObject(event.data)) return
      handlePiEvent(event.sessionId, event.data)
    }
    events.onerror = () => {
      setPiConnection('connecting')
      setActivity(null)
      showToast('error', 'Connection to backend lost; retrying.')
    }
    return () => events.close()

    /** Translates received events into UI updates and possible UI responses. */
    function handlePiEvent(sessionId: string, event: JsonObject): void {
      if (event.type === 'session_info_changed') {
        const name = typeof event.name === 'string' && event.name.trim() ? event.name.trim() : 'New session'
        setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, name } : session))
        const sessionPath = sessionsRef.current.find((session) => session.id === sessionId)?.sessionPath
        setRecentSessions((current) => current.map((recent) =>
          sessionPath && recent.sessionPath === sessionPath ? { ...recent, name } : recent))
        setSentSessions((current) => current.map((sent) =>
          sent.id === sessionId || (sessionPath && sent.sessionPath === sessionPath) ? { ...sent, name } : sent))
      }
      if (event.type === 'agent_start') updateSessionStatus(sessionId, 'running')
      if (event.type === 'agent_settled') {
        updateSessionStatus(sessionId, 'idle')
        const completedSession = sessionsRef.current.find((session) => session.id === sessionId)
        const sessionKey = completedSession?.sessionPath ?? sessionId
        if (sessionId !== selectedIdRef.current) setCompletedSessionIds((current) => new Set(current).add(sessionKey))
      }
      if (event.type === 'compaction_start') setCompactingSessionIds((current) => new Set(current).add(sessionId))
      if (event.type === 'compaction_end') setCompactingSessionIds((current) => {
        if (!current.has(sessionId)) return current
        const next = new Set(current)
        next.delete(sessionId)
        return next
      })
      if (event.type === 'auto_retry_end' && event.success === false && typeof event.finalError === 'string') {
        showToast('error', `Provider connection failed after retries: ${event.finalError}`, sessionId)
      }
      if (event.type === 'tool_execution_end') void refreshGit()
      if (event.type === 'extension_ui_request' && event.method === 'setStatus' && event.statusKey === 'agent') {
        updateSessionAgent(sessionId, typeof event.activeAgent === 'string' ? event.activeAgent : undefined)
      }
      if (event.type === 'extension_ui_request' && event.method === 'setStatus' && event.statusKey === 'pi-livecraft.quotas') {
        void getQuotas().then(setQuotas).catch(() => undefined)
      }

      if (event.type === 'extension_ui_request' && isBlockingDialog(event) && !isAgentSelector(event)) {
        if (typeof event.id === 'string') {
          setSessions((current) => current.map((session) => session.id === sessionId
            ? { ...session, pendingUi: [...session.pendingUi.filter((request) => request.id !== event.id), event] }
            : session))
        }
        if (sessionId === selectedIdRef.current) setActivity(null)
      }

      if (event.type === 'extension_ui_request') {
        if (creatingSessionRef.current && (event.method === 'notify' || (event.method === 'setStatus' && event.statusKey === 'agent'))) {
          setSelectedId(sessionId)
          creatingSessionRef.current = false
        }
        if (event.method === 'notify' && typeof event.message === 'string') showToast('notice', event.message, sessionId)
        const agentIntent = agentIntentsRef.current.get(sessionId)
        if (isAgentSelector(event)) {
          const options = event.options.filter((option): option is string => typeof option === 'string')
          if (agentIntent) {
            setAgentOptions((current) => ({ ...current, [sessionId]: options }))
            agentIntentsRef.current.delete(sessionId)
          }

          const selectedAgent = agentIntent?.value && options.includes(agentIntent.value) ? agentIntent.value : undefined
          const response = selectedAgent ? { value: selectedAgent } : { cancelled: true }
          void sendPiCommand(sessionId, { type: 'extension_ui_response', id: event.id, ...response })
            .then(() => refreshSnapshot(sessionId))
            .catch((cause) => showToast('error', messageOf(cause)))
          if (agentIntent?.value && !selectedAgent) showToast('error', 'Selected agent is no longer available.')
          return
        }
        if (isBlockingDialog(event)) setDialog({ sessionId, request: event })
      }

      if (sessionId !== selectedIdRef.current) return
      if (event.type === 'queue_update' && Array.isArray(event.steering)) {
        const steering = event.steering.filter((message): message is string => typeof message === 'string')
        const version = ++queueUpdateVersionRef.current
        setPendingSteering((current) => steering.length > current.length ? steering : current)
        void refreshSnapshot(sessionId).finally(() => {
          if (version === queueUpdateVersionRef.current && sessionId === selectedIdRef.current) setPendingSteering(steering)
        })
      }
      if (event.type === 'agent_start') requestStartedAtRef.current = performance.now()
      const streamedToolCall = toolCallInUpdate(event)
      if (streamedToolCall) {
        flushLiveUpdates()
        setToolExecutions((current) => applyToolCallUpdate(current, streamedToolCall, crypto.randomUUID()))
      }
      const toolExecutionUpdate = toolExecutionUpdateInEvent(event)
      if (toolExecutionUpdate) setToolExecutions((current) => applyToolExecutionUpdate(current, toolExecutionUpdate))
      if (event.type === 'tool_execution_start' && typeof event.toolCallId === 'string' && typeof event.toolName === 'string') {
        toolStartedAtRef.current.set(event.toolCallId, performance.now())
        startToolExecution({ id: event.toolCallId, name: event.toolName, args: event.args })
      }
      if (event.type === 'tool_execution_end' && typeof event.toolCallId === 'string' && typeof event.toolName === 'string') {
        const id = event.toolCallId
        const startedAt = toolStartedAtRef.current.get(id)
        if (startedAt !== undefined) {
          setObservedToolDurations((current) => new Map(current).set(id, performance.now() - startedAt))
          toolStartedAtRef.current.delete(id)
        }
        const eventResult = event.result
        const details = isObject(eventResult) ? eventResult.details : undefined
        const result: ToolResult = {
          toolCallId: id,
          toolName: event.toolName,
          content: event.result,
          isError: event.isError === true,
          details,
        }
        setToolExecutions((current) => current.map((execution) => execution.id === id ? { ...execution, result } : execution))
        void refreshSnapshot(sessionId)
      }
      setActivity((current) => {
        const next = activityForPiEvent(current, event)
        return next?.kind === current?.kind ? current : next
      })
      if (event.type === 'message_start') {
        turnMessageSeqRef.current += 1
        turnMessageStartedAtRef.current.set(turnMessageSeqRef.current, performance.now())
        flushLiveUpdates()
        setToolExecutions(interruptToolCallGeneration)
        const message = assistantMessageInEvent(event)
        if (message) {
          const next = [...liveMessagesRef.current, { id: crypto.randomUUID(), message }]
          liveMessagesRef.current = next
          liveMessageIndexRef.current = next.length - 1
          setLiveMessages(next)
        }
      }
      if (event.type === 'message_update' && isObject(event.assistantMessageEvent)) {
        const message = assistantMessageInEvent(event)
        if (message) queueLiveMessage(message)
        if (event.assistantMessageEvent.type === 'error') setToolExecutions(interruptToolCallGeneration)
      }
      const settledRequestDuration = event.type === 'agent_settled' && requestStartedAtRef.current !== undefined
        ? performance.now() - requestStartedAtRef.current
        : undefined
      if (event.type === 'agent_settled') {
        requestStartedAtRef.current = undefined
        void refreshSessionQuotas(sessionId, true)
      }
      if (event.type === 'message_end' || event.type === 'agent_settled') {
        if (event.type === 'message_end') {
          const ordinal = turnMessageSeqRef.current
          const startedAt = turnMessageStartedAtRef.current.get(ordinal)
          if (startedAt !== undefined) {
            setObservedTurnDurations((current) => new Map(current).set(ordinal, performance.now() - startedAt))
            turnMessageStartedAtRef.current.delete(ordinal)
          }
        }
        if (event.type === 'agent_settled') turnMessageStartedAtRef.current.clear()
        flushLiveUpdates()
        setToolExecutions(interruptToolCallGeneration)
        void refreshSnapshot(sessionId).then((nextSnapshot) => {
          if (!nextSnapshot || settledRequestDuration === undefined) return
          const requestTimestamp = lastUserTimestamp(nextSnapshot.messages)
          if (requestTimestamp !== undefined) setObservedRequestDurations((current) => new Map(current).set(requestTimestamp, settledRequestDuration))
        })
        if (event.type === 'agent_settled') setFocusComposerRequest((current) => current + 1)
      }

      /** Replaces an existing execution to keep a single state per tool call. */
      function startToolExecution(call: { id: string; name: string; args: unknown }): void {
        setToolExecutions((current) => [
          ...current.filter((execution) => execution.id !== call.id),
          { ...call, status: 'running' },
        ])
      }
    }
  }, [flushLiveUpdates, queueLiveMessage, refreshGit, refreshSessionQuotas, refreshSessions, refreshSnapshot, showToast])

  useEffect(() => {
    const exposesAgentCommand = snapshot.commands.some((command) => command.name === 'agent')
    if (snapshotSessionId === selectedId && exposesAgentCommand && !agentOptions[selectedId] && !agentBusy[selectedId]) {
      requestAgent(selectedId)
    }
  }, [agentBusy, agentOptions, requestAgent, selectedId, snapshot.commands, snapshotSessionId])

  function updateSessionStatus(sessionId: string, status: SessionSummary['status']): void {
    setSessions((current) => current.map((session) => (session.id === sessionId ? { ...session, status } : session)))
  }

  function updateSessionAgent(sessionId: string, activeAgent: string | undefined): void {
    setSessions((current) => current.map((session) => (session.id === sessionId ? { ...session, activeAgent } : session)))
  }

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
  const handleConversationError = useCallback((cause: unknown) => showToast('error', messageOf(cause)), [showToast])
  const handleComposerAgentChange = useCallback((agent: string) => requestAgent(selectedId, agent), [requestAgent, selectedId])
  /** Executes a composer command and synchronizes capabilities affected by it. */
  const handleComposerCommand = useCallback(async (command: JsonObject) => {
    const result = await sendPiCommand(selectedId, command)
    await refreshSnapshot(selectedId)
    if (command.type === 'compact') showToast('notice', 'Session compacted.')
    return result
  }, [refreshSnapshot, selectedId, showToast])
  /** Sends the current draft with the behavior supported by the active session. */
  const handleComposerSend = useCallback(async (message: string, images: JsonObject[], behavior: 'steer' | 'followUp') => {
    const command: JsonObject = { type: 'prompt', message, images }
    const isSteering = selectedSessionStatus === 'running' && behavior === 'steer'
    if (selectedSessionStatus === 'running') command.streamingBehavior = behavior
    if (isSteering) setPendingSteering((current) => [...current, message])
    const optimisticId = !isSteering ? crypto.randomUUID() : undefined
    if (optimisticId) {
      flushLiveUpdates()
      const next = [...liveMessagesRef.current, { id: optimisticId, message: { role: 'user', content: message, timestamp: Date.now() } }]
      liveMessagesRef.current = next
      setLiveMessages(next)
    }
    try {
      await sendPiCommand(selectedId, command)
      const sentSession = sessions.find((session) => session.id === selectedId)
      const shouldNameSession = sentSession?.name === 'Nouvelle session' && !snapshot.messages.some((entry) => entry.role === 'user')
      if (sentSession && shouldNameSession) {
        const name = promptSessionTitle(message)
        setSessions((current) => current.map((session) => session.id === selectedId ? { ...session, name } : session))
        const sessionPath = sentSession.sessionPath
        if (sessionPath) setSentSessions((current) => [{ id: sentSession.id, cwd: sentSession.cwd, name, sessionPath, updatedAt: Date.now() }, ...current.filter((session) => session.id !== sentSession.id && session.sessionPath !== sessionPath)])
      }
      await refreshSessions()
      setScrollToBottomRequest((current) => current + 1)
    } catch (cause) {
      if (optimisticId) {
        liveMessagesRef.current = liveMessagesRef.current.filter((lm) => lm.id !== optimisticId)
        setLiveMessages(liveMessagesRef.current)
      }
      if (isSteering) setPendingSteering((current) => {
        const index = current.lastIndexOf(message)
        return index < 0 ? current : current.toSpliced(index, 1)
      })
      throw cause
    }
  }, [flushLiveUpdates, refreshSessions, selectedId, selectedSessionStatus, sessions, snapshot.messages])
  const handleComposerAbort = useCallback(() => sendPiCommand(selectedId, { type: 'abort' }), [selectedId])
  const handlePromptImprovement = useCallback((prompt: string, direction?: string) => improvePrompt(selectedId, prompt, direction), [selectedId])
  const handleComposerSelectOpened = useCallback(() => setRequestedSelect(null), [])
  const sessionAnalysis = useMemo(() => selectedSession && snapshotSessionId === selectedSession.id
    ? analyzeSession(snapshot.messages, snapshot.stats, selectedSession.status === 'running', {
      requestDurations: observedRequestDurations,
      toolDurations: observedToolDurations,
      toolExecutions,
    })
    : null, [observedRequestDurations, observedToolDurations, selectedSession, snapshot.messages, snapshot.stats, snapshotSessionId, toolExecutions])
  const questionnaire = dialog && isAskUserQuestionDialog(dialog.request) ? dialog : null
  const questionnaireInComposer = questionnaire?.sessionId === selectedId && snapshotSessionId === selectedId

  /** Launches and selects a session, then sends a message or prepares a draft depending on the source action. */
  const startAndSelectSession = useCallback(async (start: () => Promise<SessionSummary>, initialMessage?: string, draftMessage?: string): Promise<void> => {
    creatingSessionRef.current = true
    setCreatingSession(true)
    setSelectedId('')
    try {
      const session = await start()
      await refreshSessions()
      setSelectedId(session.id)
      if (draftMessage) setComposerDraftRequest({ id: crypto.randomUUID(), message: draftMessage, sessionId: session.id })
      if (initialMessage) {
        await sendPiCommand(session.id, { type: 'prompt', message: initialMessage })
        const name = promptSessionTitle(initialMessage)
        setSessions((current) => current.map((currentSession) => currentSession.id === session.id ? { ...currentSession, name } : currentSession))
        const sessionPath = session.sessionPath
        if (sessionPath) setSentSessions((current) => [{ id: session.id, cwd: session.cwd, name, sessionPath, updatedAt: Date.now() }, ...current.filter((recentSession) => recentSession.id !== session.id && recentSession.sessionPath !== sessionPath)])
        await refreshSessions()
        setScrollToBottomRequest((current) => current + 1)
      }
      creatingSessionRef.current = false
      setCreatingSession(false)
    } catch (cause) {
      creatingSessionRef.current = false
      setCreatingSession(false)
      showToast('error', messageOf(cause))
    }
  }, [refreshSessions, showToast])

  const handleContextSessionStart = useCallback((draft: string) => startAndSelectSession(() => createSession(workspacePath), undefined, draft), [startAndSelectSession, workspacePath])

  const markComposerDraftApplied = useCallback((id: string) => {
    setComposerDraftRequest((current) => current?.id === id ? undefined : current)
  }, [])

  /** Executes a productivity command in the context of the active session. */
  const executeCommand = useCallback((id: CommandId): void => {
    const rightWidget = rightWidgetFromCommand(id)
    if (rightWidget) {
      if ((rightWidget === 'analysis' && !sessionAnalysis) || (rightWidget === 'git' && !gitSnapshot?.repository)) return
      openRightWidget(rightWidget)
      return
    }
    if (id === 'open-palette') { setCommandPaletteOpen(true); return }
    if (id === 'open-settings') { setSettingsOpen(true); return }
    if (id === 'open-terminal') { void openTerminal(workspacePath, terminalCommand).catch((cause) => showToast('error', messageOf(cause))); return }
    if (id === 'new-session') { void startAndSelectSession(() => createSession(workspacePath)).catch((cause) => showToast('error', messageOf(cause))); return }
    if (id === 'send') { setSubmitRequest((current) => current + 1); return }
    if (id === 'abort' && selectedId) { void sendPiCommand(selectedId, { type: 'abort' }).catch((cause) => showToast('error', messageOf(cause))); return }
    if (id === 'open-agent' || id === 'open-model' || id === 'open-thinking') { setRequestedSelect(id === 'open-agent' ? 'agent' : id === 'open-model' ? 'model' : 'thinking'); return }
    if (id === 'copy-last-response') {
      const text = lastAssistantText(snapshot.messages)
      if (!text) { showToast('notice', 'No assistant response to copy.'); return }
      void navigator.clipboard.writeText(text).then(() => showToast('notice', 'Last response copied.')).catch((cause) => showToast('error', messageOf(cause)))
      return
    }
    if (id === 'open-directory-picker') { setDirectoryPickerOpen(true); return }
    if (id === 'workspace-previous' && recentWorkspacePaths.length > 1) { selectWorkspace(recentWorkspacePaths[1]); return }
    if (id === 'focus-composer') { setFocusComposerRequest((current) => current + 1); return }
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
    if (id === 'open-explorer') { void openExplorer(workspacePath).catch((cause) => showToast('error', messageOf(cause))); return }
  }, [gitSnapshot?.repository, openRightWidget, recentSessions, recentWorkspacePaths, selectWorkspace, selectedId, sentSessions, sessionAnalysis, showToast, snapshot.messages, startAndSelectSession, terminalCommand, workspacePath])

  const paletteCommands: PaletteCommand[] = useMemo(() => {
    const visibleIds = sidebarSessions(recentSessions, workspacePath, sentSessions).map((session) => session.id)
    const selectedIndex = selectedId ? visibleIds.indexOf(selectedId) : -1
    return commandDefinitions.map((definition) => {
      const rightWidget = rightWidgetFromCommand(definition.id)
      const unavailableWidget = (rightWidget === 'analysis' && !sessionAnalysis) || (rightWidget === 'git' && !gitSnapshot?.repository)
      return {
        ...definition,
        shortcut: shortcuts[definition.id],
        disabled: unavailableWidget
          || (['send', 'abort', 'open-thinking', 'open-model', 'open-agent', 'copy-last-response'] as CommandId[]).includes(definition.id) && !selectedSession
          || (definition.id === 'abort' && selectedSession?.status !== 'running')
          || (definition.id === 'workspace-previous' && recentWorkspacePaths.length < 2)
          || (definition.id === 'next-session' && (selectedIndex === -1 || selectedIndex >= visibleIds.length - 1))
          || (definition.id === 'previous-session' && selectedIndex <= 0),
        onExecute: () => executeCommand(definition.id),
      }
    })
  }, [executeCommand, gitSnapshot?.repository, recentSessions, recentWorkspacePaths, selectedId, selectedSession, sentSessions, sessionAnalysis, shortcuts, workspacePath])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) && event.key !== 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) return
      const shortcut = shortcutFromEvent(event)
      const command = (Object.entries(shortcuts) as [CommandId, string | undefined][]).find(([, value]) => value === shortcut)?.[0]
      if (!command) return
      if (event.key === 'Escape' && (commandPaletteOpen || settingsOpen || dialog || document.querySelector('.composer-select-content,[data-radix-select-content],.slash-commands'))) return
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

  /** Actions pinned to the right rail without an associated panel. */
  const railActions = useMemo(() => [
    {
      key: 'explorer',
      icon: <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2h7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /><path d="M3 9h18" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>,
      label: 'Open folder',
      onClick: () => { void openExplorer(workspacePath).catch((cause) => showToast('error', messageOf(cause))) },
    },
    {
      key: 'terminal',
      icon: <span aria-hidden="true">›_</span>,
      label: 'Open terminal',
      onClick: () => { void openTerminal(workspacePath, terminalCommand).catch((cause) => showToast('error', messageOf(cause))) },
    },
  ], [showToast, terminalCommand, workspacePath])

  const rightPanelVisible = activeRightWidget === 'todo' || activeRightWidget === 'quotas'
    || (activeRightWidget === 'analysis' && sessionAnalysis !== null)
    || (activeRightWidget === 'git' && gitSnapshot?.repository === true)

  return (
    <div
      className={`app-shell ${rightPanelVisible ? 'right-sidebar-visible' : 'right-sidebar-collapsed'}`}
      style={{ '--right-sidebar-width': `${rightSidebarWidth}px` } as CSSProperties}
    >
      <WorkspaceSidebar
        compactingSessionIds={compactingSessionIds}
        completedSessionIds={completedSessionIds}
        recentSessions={recentSessions}
        sentSessions={sentSessions}
        sessions={sessions}
        selectedId={selectedId}
        workspacePath={workspacePath}
        onChooseWorkspace={() => setDirectoryPickerOpen(true)}
        onCreate={() => startAndSelectSession(() => createSession(workspacePath))}
        onOpenSession={(recentSession) => startAndSelectSession(() => openSession(workspacePath, recentSession.sessionPath))}
        onSelectOtherWorkspaceSession={(session) => selectWorkspace(session.cwd, session.id)}
        onSelectSession={setSelectedId}
        onError={(cause) => showToast('error', messageOf(cause))}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="workspace">
        <ManagerRuntimeNotice
          activeSession={sessions.some(({ status }) => status === 'running' || status === 'starting')}
          status={managerRuntimeStatus}
          onError={(cause) => showToast('error', messageOf(cause))}
          onRestart={restartManager}
        />
        {selectedSession ? (
          <>
            {(snapshotSessionId === selectedSession.id || loadingPhase === 'exiting') && (
              <>
                <Conversation activity={displayedActivity} agentName={selectedSession.activeAgent} darkMode={activeTheme.mode === 'dark'} detailedView={conversationView === 'detailed'} key={selectedSession.id} liveMessages={liveMessages} messages={snapshot.messages} navigationRequest={conversationNavigation} onError={handleConversationError} onStartSession={handleContextSessionStart} pendingSteering={pendingSteering} repositoryRoot={gitSnapshot?.root} scrollToBottomRequest={scrollToBottomRequest} toolExecutions={toolExecutions} turnDurations={observedTurnDurations} workspacePath={workspacePath} />
                <Tooltip label={`${conversationViewDetail.label} — ${conversationViewDetail.description}`}><button aria-label={`${conversationViewDetail.label}. ${conversationViewDetail.description}. Click to toggle view.`} className={`chat-detail-toggle ${conversationView}`} onClick={() => setConversationView((current) => {
                    const next = current === 'simple' ? 'detailed' : 'simple'
                    window.localStorage.setItem('pi-livecraft.conversation-view', next)
                    return next
                  })} type="button">
                  <span aria-hidden="true" className="chat-detail-toggle-icon">⌘</span>
                  <span className="chat-detail-toggle-copy"><strong>{conversationViewDetail.label}</strong><small>{conversationViewDetail.description}</small></span>
                </button></Tooltip>
                <div className="composer-area">
                  {questionnaire && questionnaireInComposer && <AskUserQuestionDialog canMinimize dialog={questionnaire} key={String(questionnaire.request.id)} sessionName={selectedSession.name} onClose={() => closeDialog(questionnaire)} onError={(cause) => showToast('error', messageOf(cause))} />}
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
                  draftRequest={composerDraftRequest?.sessionId === selectedSession.id ? composerDraftRequest : undefined}
                  onDraftApplied={markComposerDraftApplied}
                  showAgentSelector={snapshotSessionId !== selectedSession.id || snapshot.commands.some((command) => command.name === 'agent')}
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
                <section aria-busy={loadingPhase !== 'exiting' ? true : undefined} aria-live={loadingPhase !== 'exiting' ? "polite" : undefined} className={`welcome session-loading session-loading-${loadingPhase}`}>
                  <span className="brand-mark large brand-mark-loading">π</span>
                  <h1>Connecting to Pi…</h1>
                  <p>Loading the session and its capabilities.</p>
                  <span aria-hidden="true" className="session-loading-indicator" />
                </section>
                {loadingPhase !== 'exiting' && <ToastStack onDismiss={dismissToast} standalone toasts={visibleToasts} />}
              </>
            )}
          </>
        ) : creatingSession ? (
          <>
            <section className="welcome" aria-busy="true">
              <span className="brand-mark large brand-mark-loading">π</span>
              <h1>Starting new session…</h1>
              <p>Initializing Pi and its agents.</p>
              <span aria-hidden="true" className="session-loading-indicator" />
            </section>
            <ToastStack onDismiss={dismissToast} standalone toasts={visibleToasts} />
          </>
        ) : (
          <>
            <section className="welcome">
              <span className="brand-mark large">π</span>
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
        onTodoSendPrompt={(message) => startAndSelectSession(() => createSession(workspacePath), message)}
        onTodoStartSession={(message) => startAndSelectSession(() => createSession(workspacePath), undefined, message)}
        onWidgetSelect={(widget) => setActiveRightWidget((current) => {
          const next = current === widget ? null : widget
          window.localStorage.setItem('pi-livecraft.right-sidebar-widget', next ?? 'none')
          return next
        })}
      />

      {directoryPickerOpen && <DirectoryPicker
        initialPath={workspacePath}
        recentPaths={recentWorkspacePaths}
        onClose={() => setDirectoryPickerOpen(false)}
        onError={(cause) => showToast('error', messageOf(cause))}
        onSelect={selectWorkspace}
      />}
      {questionnaire && !questionnaireInComposer && <AskUserQuestionDialog canMinimize={false} key={String(questionnaire.request.id)} dialog={questionnaire} sessionName={sessions.find((session) => session.id === questionnaire.sessionId)?.name} onClose={() => closeDialog(questionnaire)} onError={(cause) => showToast('error', messageOf(cause))} />}
      {dialog && !questionnaire && <ExtensionDialog dialog={dialog} onClose={() => closeDialog(dialog)} onError={(cause) => showToast('error', messageOf(cause))} />}
      {commandPaletteOpen && <CommandPalette commands={paletteCommands} onClose={() => setCommandPaletteOpen(false)} />}
      {settingsOpen && <SettingsPanel definitions={commandDefinitions} shortcuts={shortcuts} terminalCommand={terminalCommand} themes={allThemes(themePreferences)} activeThemeId={activeTheme.id} onChange={(id, shortcut) => { const next = { ...shortcuts, [id]: shortcut }; setShortcuts(next); window.localStorage.setItem('pi-livecraft.shortcuts', JSON.stringify(next)) }} onTerminalCommandChange={(value) => { setTerminalCommand(value); window.localStorage.setItem('pi-livecraft.terminal-command', value) }} onSelectTheme={selectTheme} onDuplicateTheme={duplicateActiveTheme} onRenameTheme={renameSelectedTheme} onUpdateThemeColor={updateSelectedThemeColor} onDeleteTheme={deleteSelectedTheme} onReset={() => { setShortcuts(defaultShortcuts); window.localStorage.setItem('pi-livecraft.shortcuts', JSON.stringify(defaultShortcuts)) }} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

/** Lit une éventuelle ancienne liste invalide sans empêcher l'ouverture de l'application. */
function readShortcuts(): Partial<Record<CommandId, string>> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem('pi-livecraft.shortcuts') ?? 'null')
    if (!isObject(value)) return defaultShortcuts
    const primaryModifier = navigator.platform.toLowerCase().includes('mac') ? 'meta' : 'ctrl'
    const stored = Object.entries(value)
      .filter(([key, shortcut]) => key !== 'send' && commandDefinitions.some((definition) => definition.id === key) && typeof shortcut === 'string')
      .map(([key, shortcut]) => [key, migrateLegacyShortcut(shortcut as string, primaryModifier)])
    return { ...defaultShortcuts, ...Object.fromEntries(stored) } as Partial<Record<CommandId, string>>
  } catch { return defaultShortcuts }
}

/** Reads the persisted list of recent workspace paths from localStorage. */
function readRecentWorkspaces(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem('pi-livecraft.recent-workspace-paths') ?? '[]')
    return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : []
  } catch {
    return []
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

function isManagerEvent(value: unknown): value is ManagerEvent {
  return isObject(value) && value.kind === 'event' && typeof value.event === 'string' && typeof value.sessionId === 'string'
}

function isManagerRuntimeStatus(value: unknown): value is ManagerRuntimeStatus {
  if (!isObject(value) || typeof value.canRestart !== 'boolean' || typeof value.state !== 'string') return false
  return value.state === 'checking' || value.state === 'current' || value.state === 'stale' || value.state === 'restarting' || value.state === 'disconnected' || value.state === 'unknown'
}

/** Returns the timestamp of the most recent user message, if any. */
function lastUserTimestamp(messages: JsonObject[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && typeof message.timestamp === 'number') return message.timestamp
  }
  return undefined
}

/** Reads the complete assistant message carried by a public Pi stream event. */
function assistantMessageInEvent(event: JsonObject): JsonObject | null {
  const message = event.message
  return isObject(message) && message.role === 'assistant' ? message : null
}
const COMPLETED_SESSIONS_KEY = 'pi-livecraft.completed-sessions'
const MAX_COMPLETED_SESSIONS = 30

/** Restores completed-session identifiers persisted across same-tab refreshes. */
function readCompletedSessionIds(): ReadonlySet<string> {
  try {
    const stored = sessionStorage.getItem(COMPLETED_SESSIONS_KEY)
    if (!stored) return new Set()
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return new Set()
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
    return new Set(ids.slice(0, MAX_COMPLETED_SESSIONS))
  } catch {
    return new Set()
  }
}

/** Persists completed-session identifiers so they survive a page refresh within the same tab. */
function writeCompletedSessionIds(ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) sessionStorage.removeItem(COMPLETED_SESSIONS_KEY)
    else sessionStorage.setItem(COMPLETED_SESSIONS_KEY, JSON.stringify([...ids].slice(0, MAX_COMPLETED_SESSIONS)))
  } catch {
    // sessionStorage may be unavailable
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export default App
