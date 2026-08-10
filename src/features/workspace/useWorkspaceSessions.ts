import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  closeSession as requestCloseSession,
  getGitProject,
  listRecentSessions,
  listSessions,
  openSession as requestOpenSession,
  renameSession as renameStoredSession,
  resolveSessions,
  sendPiCommand,
} from '../../api.ts'
import type {
  GitProject,
  JsonObject,
  RecentSession,
  SessionSummary,
} from '../../../shared/types.ts'
import { promptSessionTitle } from '../composer/prompt-title.ts'
import { readPinnedSessions, togglePinnedSession, writePinnedSessions } from './pinned-sessions.ts'
import { recentWorkspaces } from './recent-workspaces.ts'
import type { Project } from './projects.ts'
import {
  newestWorkspaceSession,
  nextActiveSessionId,
  reusableNewSession,
  sidebarSessions,
  type SessionActionTarget,
} from './sidebar-sessions.ts'

interface WorkspaceSessionsOptions {
  project: Project
  /** Workspace requested by the URL; preferred over the persisted default. */
  initialWorkspacePath?: string
  /** Session path requested by the URL; opened instead of auto-selecting the newest. */
  initialSessionPath?: string
  onDraftMessage: (sessionId: string, message: string) => void
  onError: (cause: unknown) => void
  onInitialMessageSent: () => void
  onSessionsRefreshed: (sessions: SessionSummary[]) => void
  onWorkspaceSelected: () => void
}

interface StartSessionOptions {
  draftMessage?: string
  refreshCwd?: string
  initialImages?: JsonObject[]
  initialMessage?: string
  nameFromInitialMessage?: boolean
}

const MAX_COMPLETED_SESSIONS = 30

/** Owns workspace selection, session lists, persistence, and session creation. */
export function useWorkspaceSessions(
  {
    project,
    initialWorkspacePath,
    initialSessionPath,
    onDraftMessage,
    onError,
    onInitialMessageSent,
    onSessionsRefreshed,
    onWorkspaceSelected,
  }: WorkspaceSessionsOptions,
) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])
  const [sentSessions, setSentSessions] = useState<RecentSession[]>([])
  const [pinnedSessions, setPinnedSessions] = useState<RecentSession[]>(() =>
    readPinnedSessions(window.localStorage, project.id)
  )
  const [completedSessionIds, setCompletedSessionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(true)
  const [sessionLoadError, setSessionLoadError] = useState<unknown | null>(null)
  const workspacePathKey = `pi-livecraft.project-workspace.${project.id}`
  const recentWorkspacePathsKey = `pi-livecraft.project-recent-workspaces.${project.id}`
  const [workspacePath, setWorkspacePath] = useState(() =>
    initialWorkspacePath ?? window.localStorage.getItem(workspacePathKey) ?? project.root
  )
  /** Consumed once by the first auto-select refresh; restored from the URL on reload. */
  const initialSessionPathRef = useRef<string | null>(initialSessionPath ?? null)
  const [recentWorkspacePathsState, setRecentWorkspacePathsState] = useState(() =>
    recentWorkspaces(
      window.localStorage.getItem(workspacePathKey) ?? project.root,
      readRecentWorkspaces(recentWorkspacePathsKey),
    )
  )
  const [projectDiscoveryComplete, setProjectDiscoveryComplete] = useState(false)
  const [projectDiscoveryError, setProjectDiscoveryError] = useState<unknown | null>(null)
  const [discoveryVersion, setDiscoveryVersion] = useState(0)
  const [projectWorkspaces, setProjectWorkspaces] = useState<Record<string, GitProject>>({})
  /** Valid workspace paths from the live `getGitProject` result — the single source of truth. */
  const workspacePaths = useMemo(
    () =>
      Object.values(projectWorkspaces).flatMap((entry) =>
        entry.workspaces.map((workspace) => workspace.path)
      ),
    [projectWorkspaces],
  )
  /** Recent workspace paths (for the previous-workspace shortcut), filtered to those still present. */
  const recentWorkspacePaths = useMemo(() => {
    const valid = new Set(workspacePaths)
    return recentWorkspacePathsState.filter((path) => valid.has(path))
  }, [recentWorkspacePathsState, workspacePaths])
  const [selectedId, setSelectedId] = useState('')
  const [creatingSession, setCreatingSession] = useState(false)
  const sessionsRef = useRef(sessions)
  const recentSessionsRef = useRef(recentSessions)
  const sentSessionsRef = useRef(sentSessions)
  const completedSessionIdsRef = useRef(completedSessionIds)
  const pinnedSessionsRef = useRef(pinnedSessions)
  const selectedIdRef = useRef(selectedId)
  const creatingSessionRef = useRef(false)
  const transientNewSessionIdRef = useRef<string | null>(null)
  const refreshVersionRef = useRef(0)
  const autoSelectOnRefreshRef = useRef(true)
  sessionsRef.current = sessions
  recentSessionsRef.current = recentSessions
  sentSessionsRef.current = sentSessions
  completedSessionIdsRef.current = completedSessionIds
  pinnedSessionsRef.current = pinnedSessions
  selectedIdRef.current = selectedId

  useEffect(() => () => {
    const transientId = transientNewSessionIdRef.current
    if (transientId) void requestCloseSession(transientId).catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true
    setProjectDiscoveryComplete(false)
    setProjectDiscoveryError(null)
    void getGitProject(project.root)
      .then((details) => {
        if (active) setProjectWorkspaces({ [project.root]: details })
      })
      .catch((cause) => {
        if (active) setProjectDiscoveryError(cause)
      })
      .finally(() => active && setProjectDiscoveryComplete(true))
    return () => {
      active = false
    }
  }, [project.root, discoveryVersion])

  useEffect(() => {
    if (selectedId) window.localStorage.setItem('pi-livecraft.selected-session', selectedId)
    else window.localStorage.removeItem('pi-livecraft.selected-session')
    setCompletedSessionIds((current) => {
      const sessionKey = sessionsRef
        .current
        .find((session) => session.id === selectedId)
        ?.sessionPath ?? selectedId
      if (!current.has(sessionKey)) return current
      const next = new Set(current)
      next.delete(sessionKey)
      return next
    })
  }, [selectedId])

  useEffect(() => {
    writePinnedSessions(window.localStorage, project.id, pinnedSessions)
  }, [pinnedSessions, project.id])

  /** Refreshes pinned-session metadata by path without scanning the whole session store. */
  const refreshPinnedSessions = useCallback(async (): Promise<void> => {
    const paths = pinnedSessionsRef.current.map(({ sessionPath }) => sessionPath)
    if (paths.length === 0) return
    try {
      const resolved = await resolveSessions(paths)
      setPinnedSessions((current) =>
        current.map((pinned) =>
          resolved.find(({ sessionPath }) => sessionPath === pinned.sessionPath) ?? pinned
        )
      )
    } catch {
      // Pins keep their last known metadata until a later refresh succeeds.
    }
  }, [])

  useEffect(() => {
    void refreshPinnedSessions()
  }, [refreshPinnedSessions])

  /** Reloads sessions while discarding responses superseded by a newer workspace refresh. */
  const refreshSessions = useCallback(async (cwd = workspacePath) => {
    const version = ++refreshVersionRef.current
    const shouldAutoSelect = autoSelectOnRefreshRef.current
    setIsRefreshingSessions(true)
    try {
      const [listedSessions, nextRecentSessions] = await Promise.all([
        listSessions(),
        listRecentSessions(cwd),
      ])
      if (version !== refreshVersionRef.current) return
      let nextSessions = listedSessions
      let autoSelectId: string | undefined
      if (shouldAutoSelect) {
        const openTarget = async (target: {
          sessionPath?: string
          activeSessionId?: string
        }): Promise<string | undefined> => {
          if (target.activeSessionId) return target.activeSessionId
          if (!target.sessionPath) return undefined
          const opened = await requestOpenSession(cwd, target.sessionPath)
          if (version !== refreshVersionRef.current) return undefined
          nextSessions = [
            ...nextSessions.filter((session) =>
              session.id !== opened.id && session.sessionPath !== opened.sessionPath
            ),
            opened,
          ]
          return opened.id
        }
        const newestTarget = (): { sessionPath?: string; activeSessionId?: string } | null =>
          newestWorkspaceSession(
            sidebarSessions(nextRecentSessions, cwd, sentSessionsRef.current),
            nextSessions,
          )
        const forcedPath = initialSessionPathRef.current
        if (forcedPath) initialSessionPathRef.current = null
        if (forcedPath) {
          try {
            autoSelectId = await openTarget({ sessionPath: forcedPath })
          } catch {
            // A stale workspace/session from the URL; fall back to the newest session.
            autoSelectId = undefined
          }
        }
        if (autoSelectId === undefined) {
          const target = newestTarget()
          if (target) autoSelectId = await openTarget(target)
        }
      }
      const recentNames = new Map(
        nextRecentSessions.map((session) => [session.sessionPath, session.name]),
      )
      const namedSessions = nextSessions.map((session) => {
        const recentName = session.sessionPath ? recentNames.get(session.sessionPath) : undefined
        const previousName = sessionsRef.current.find((current) => current.id === session.id)?.name
        return recentName
          ? { ...session, name: recentName }
          : previousName && previousName !== 'New session'
          ? { ...session, name: previousName }
          : session
      })
      setSessionLoadError(null)
      setSessions(namedSessions)
      setCompletedSessionIds((current) => {
        if (current.size === 0) return current
        const sessionKeys = new Set(
          nextSessions.flatMap((session) =>
            [session.id, session.sessionPath].filter((key): key is string => Boolean(key))
          ),
        )
        const recentKeys = new Set(nextRecentSessions.map((session) => session.sessionPath))
        const next = keepRecentCompletedSessionIds(
          [...current].filter((key) => sessionKeys.has(key) || recentKeys.has(key)),
        )
        return next.size === current.size ? current : next
      })
      setRecentSessions(nextRecentSessions)
      setSentSessions((current) =>
        current.filter((sent) =>
          !nextRecentSessions.some((recent) =>
            recent.id === sent.id || recent.sessionPath === sent.sessionPath
          )
        )
      )
      if (shouldAutoSelect) {
        autoSelectOnRefreshRef.current = false
        setSelectedId(autoSelectId ?? '')
      } else {
        setSelectedId((current) =>
          nextSessions.some((session) => session.id === current) ? current : ''
        )
      }
      onSessionsRefreshed(nextSessions)
    } catch (cause) {
      if (version === refreshVersionRef.current) {
        setSessionLoadError(cause)
        onError(cause)
      }
    } finally {
      if (version === refreshVersionRef.current) setIsRefreshingSessions(false)
    }
  }, [onError, onSessionsRefreshed, workspacePath])

  /** Re-runs project discovery after a failed load without leaving the project view. */
  const retryProjectDiscovery = useCallback((): void => {
    setDiscoveryVersion((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!projectDiscoveryComplete || projectDiscoveryError) return
    void refreshSessions()
  }, [projectDiscoveryComplete, projectDiscoveryError, refreshSessions])

  /** Stops and removes an unmessaged session when navigation abandons it. */
  const discardTransientNewSession = useCallback((nextSessionId?: string): void => {
    const transientId = transientNewSessionIdRef.current
    if (!transientId || transientId === nextSessionId) return
    transientNewSessionIdRef.current = null
    const sessionPath = sessionsRef.current.find(({ id }) => id === transientId)?.sessionPath
    setSessions((current) => current.filter(({ id }) => id !== transientId))
    setSentSessions((current) =>
      current.filter((session) => session.id !== transientId && session.sessionPath !== sessionPath)
    )
    void requestCloseSession(transientId).catch(onError)
  }, [onError])

  const selectSession = useCallback((sessionId: string): void => {
    discardTransientNewSession(sessionId)
    setSelectedId(sessionId)
  }, [discardTransientNewSession])

  /** Selects a workspace, optionally preserving an explicit session over automatic selection. */
  const selectWorkspace = useCallback((path: string, targetSessionId?: string): void => {
    window.localStorage.setItem(workspacePathKey, path)
    const nextRecentWorkspacePaths = recentWorkspaces(path, recentWorkspacePathsState)
    window.localStorage.setItem(
      recentWorkspacePathsKey,
      JSON.stringify(nextRecentWorkspacePaths),
    )
    setRecentWorkspacePathsState(nextRecentWorkspacePaths)
    discardTransientNewSession(targetSessionId)
    onWorkspaceSelected()
    setWorkspacePath(path)
    setSelectedId(targetSessionId ?? '')
    autoSelectOnRefreshRef.current = targetSessionId === undefined
    void refreshSessions(path)
  }, [
    discardTransientNewSession,
    onWorkspaceSelected,
    recentWorkspacePathsState,
    recentWorkspacePathsKey,
    refreshSessions,
    workspacePathKey,
  ])

  // A removed worktree can remain in localStorage after Git prunes it; fall back to a live one.
  useEffect(() => {
    if (workspacePaths.length > 0 && !workspacePaths.includes(workspacePath))
      selectWorkspace(workspacePaths[0])
  }, [workspacePaths, selectWorkspace, workspacePath])

  /** Stores the optimistic title shared by first prompts in new and existing sessions. */
  const nameSessionFromFirstPrompt = useCallback(
    (session: SessionSummary, message: string): void => {
      const name = promptSessionTitle(message)
      setSessions((current) =>
        current.map((candidate) => candidate.id === session.id ? { ...candidate, name } : candidate)
      )
      const sessionPath = session.sessionPath
      if (!sessionPath) return
      setSentSessions((current) => [
        {
          id: session.id,
          cwd: session.cwd,
          name,
          sessionPath,
          updatedAt: Date.now(),
        },
        ...current.filter((recent) =>
          recent.id !== session.id && recent.sessionPath !== sessionPath
        ),
      ])
    },
    [],
  )

  const rememberStartedSession = useCallback((session: SessionSummary): void => {
    const sessionPath = session.sessionPath
    if (!sessionPath) return
    setSentSessions((current) => [
      {
        id: session.id,
        cwd: session.cwd,
        name: session.name || 'New session',
        sessionPath,
        updatedAt: Date.now(),
      },
      ...current.filter((recent) => recent.id !== session.id && recent.sessionPath !== sessionPath),
    ])
  }, [])

  /** Launches and selects a session, then sends or prepares its optional first prompt.
   *  Returns the created session summary, or null when an error prevented the operation. */
  const startAndSelectSession = useCallback(
    async (
      start: () => Promise<SessionSummary>,
      options: StartSessionOptions = {},
    ): Promise<SessionSummary | null> => {
      discardTransientNewSession()
      creatingSessionRef.current = true
      setCreatingSession(true)
      setSelectedId('')
      try {
        const session = await start()
        rememberStartedSession(session)
        await refreshSessions(options.refreshCwd)
        setSelectedId(session.id)
        if (options.draftMessage) onDraftMessage(session.id, options.draftMessage)
        if (options.initialMessage) {
          await sendPiCommand(session.id, {
            type: 'prompt',
            message: options.initialMessage,
            images: options.initialImages ?? [],
          })
          if (options.nameFromInitialMessage !== false)
            nameSessionFromFirstPrompt(session, options.initialMessage)
          await refreshSessions(options.refreshCwd)
          onInitialMessageSent()
        }
        return session
      } catch (cause) {
        onError(cause)
        return null
      } finally {
        creatingSessionRef.current = false
        setCreatingSession(false)
      }
    },
    [
      discardTransientNewSession,
      nameSessionFromFirstPrompt,
      onDraftMessage,
      onError,
      onInitialMessageSent,
      refreshSessions,
      rememberStartedSession,
    ],
  )

  /** Reuses the workspace's empty live session, or starts one when none exists. */
  const startNewSession = useCallback(
    async (start: () => Promise<SessionSummary>): Promise<SessionSummary | null> => {
      const markedId = transientNewSessionIdRef.current
      const marked = markedId
        ? sessionsRef.current.find((session) => session.id === markedId)
        : undefined
      const existing = marked ?? reusableNewSession(
        sessionsRef.current,
        recentSessionsRef.current,
        workspacePath,
      )
      if (existing) {
        transientNewSessionIdRef.current = existing.id
        rememberStartedSession(existing)
        setSelectedId(existing.id)
        return existing
      }
      transientNewSessionIdRef.current = null
      const created = await startAndSelectSession(start)
      if (created) transientNewSessionIdRef.current = created.id
      return created
    },
    [rememberStartedSession, startAndSelectSession, workspacePath],
  )

  /** Keeps a new session once its first user message succeeds. */
  const retainNewSession = useCallback((sessionId: string): void => {
    if (transientNewSessionIdRef.current === sessionId)
      transientNewSessionIdRef.current = null
  }, [])

  const toggleProjectPin = useCallback((target: SessionActionTarget): void => {
    const sessionPath = target.sessionPath
    if (!sessionPath) return
    setPinnedSessions((current) => {
      const existing = current.find((session) => session.sessionPath === sessionPath)
      if (existing) return togglePinnedSession(current, existing)
      const session = [...sentSessionsRef.current, ...recentSessionsRef.current]
        .find((candidate) => candidate.sessionPath === sessionPath)
      return session ? togglePinnedSession(current, session) : current
    })
  }, [])

  /** Opens a pin from any workspace while preserving the explicit target over auto-selection. */
  const openPinnedSession = useCallback(async (recent: RecentSession): Promise<void> => {
    const active = sessionsRef.current.find((session) =>
      session.sessionPath === recent.sessionPath && session.status !== 'exited'
    )
    if (active) {
      if (active.cwd === workspacePath) selectSession(active.id)
      else selectWorkspace(active.cwd, active.id)
      return
    }
    if (recent.cwd !== workspacePath) selectWorkspace(recent.cwd, '')
    await startAndSelectSession(
      () => requestOpenSession(recent.cwd, recent.sessionPath),
      { refreshCwd: recent.cwd },
    )
  }, [selectSession, selectWorkspace, startAndSelectSession, workspacePath])

  const updateSession = useCallback(
    (
      sessionId: string,
      update: Partial<Pick<SessionSummary, 'activeAgent' | 'name' | 'status'>>,
    ): void => {
      setSessions((current) =>
        current.map((session) => session.id === sessionId ? { ...session, ...update } : session)
      )
    },
    [],
  )

  /** Applies a manager-provided name consistently across live and recent session lists. */
  const renameSession = useCallback((sessionId: string, name: string): void => {
    const sessionPath = sessionsRef.current.find((session) => session.id === sessionId)?.sessionPath
    setSessions((current) =>
      current.map((session) => session.id === sessionId ? { ...session, name } : session)
    )
    if (!sessionPath) return
    setRecentSessions((current) =>
      current.map((session) => session.sessionPath === sessionPath ? { ...session, name } : session)
    )
    setSentSessions((current) =>
      current.map((session) =>
        session.id === sessionId || session.sessionPath === sessionPath
          ? { ...session, name }
          : session
      )
    )
    setPinnedSessions((current) =>
      current.map((session) => session.sessionPath === sessionPath ? { ...session, name } : session)
    )
  }, [])

  /** Renames through the persisted-session RPC so the name survives new browser tabs. */
  const renameManagedSession = useCallback(
    async (target: SessionActionTarget, name: string): Promise<void> => {
      const normalized = name.trim()
      if (!normalized) throw new Error('Session name is required')
      if (!target.sessionPath) throw new Error('Session path is unavailable')
      await renameStoredSession(target.cwd, target.sessionPath, normalized)
      await refreshSessions()
    },
    [refreshSessions],
  )

  /** Stops a managed process, keeps its persisted history, and selects a nearby active session. */
  const closeManagedSession = useCallback(async (sessionId: string): Promise<void> => {
    const nextId = selectedIdRef.current === sessionId
      ? nextActiveSessionId(
        sessionId,
        sessionsRef.current,
        recentSessionsRef.current,
        workspacePath,
        sentSessionsRef.current,
      )
      : null
    await requestCloseSession(sessionId)
    if (selectedIdRef.current === sessionId) setSelectedId(nextId ?? '')
    await refreshSessions()
  }, [refreshSessions, workspacePath])

  /** Adds or replaces a pending UI request for a session. */
  const addPendingRequest = useCallback((sessionId: string, request: JsonObject): void => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
            ...session,
            pendingUi: [
              ...session
                .pendingUi
                .filter((pending) => pending.id !== request.id),
              request,
            ],
          }
          : session
      )
    )
  }, [])

  /** Removes an answered UI request before the next manager reconciliation. */
  const removePendingRequest = useCallback((sessionId: string, requestId: string): void => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
            ...session,
            pendingUi: session.pendingUi.filter((request) => request.id !== requestId),
          }
          : session
      )
    )
  }, [])

  const markSessionCompleted = useCallback((sessionId: string): void => {
    if (sessionId === selectedIdRef.current) return
    const sessionKey = sessionsRef.current.find((session) => session.id === sessionId)?.sessionPath
      ?? sessionId
    setCompletedSessionIds((current) => {
      const next = new Set(current)
      next.delete(sessionKey)
      next.add(sessionKey)
      return keepRecentCompletedSessionIds(next)
    })
  }, [])

  const selectCreatedSession = useCallback((sessionId: string): void => {
    if (!creatingSessionRef.current) return
    setSelectedId(sessionId)
    creatingSessionRef.current = false
  }, [])

  return {
    addPendingRequest,
    closeManagedSession,
    completedSessionIds,
    creatingSession,
    isRefreshingSessions,
    markSessionCompleted,
    nameSessionFromFirstPrompt,
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
    retryProjectDiscovery,
    projectDiscoveryError,
    selectCreatedSession,
    selectedId,
    sentSessions,
    sessionLoadError,
    sessions,
    setSelectedId: selectSession,
    selectWorkspace,
    startAndSelectSession,
    startNewSession,
    toggleProjectPin,
    updateSession,
    workspacePath,
  }
}

/** Reads the persisted list of recent workspace paths from localStorage. */
function readRecentWorkspaces(storageKey: string): string[] {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(storageKey) ?? '[]',
    )
    return Array.isArray(value)
      ? value.filter((path): path is string => typeof path === 'string')
      : []
  } catch {
    return []
  }
}

function keepRecentCompletedSessionIds(ids: Iterable<string>): ReadonlySet<string> {
  return new Set([...ids].slice(-MAX_COMPLETED_SESSIONS))
}
