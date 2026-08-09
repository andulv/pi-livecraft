import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closeSession as requestCloseSession,
  getGitProject,
  listRecentSessions,
  listSessions,
  openSession as requestOpenSession,
  renameSession as renameStoredSession,
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
  const workspacePathKey = `pi-livecraft.project-workspace.${project.id}`
  const recentWorkspacePathsKey = `pi-livecraft.project-recent-workspaces.${project.id}`
  const [workspacePath, setWorkspacePath] = useState(() =>
    window.localStorage.getItem(workspacePathKey) ?? project.root
  )
  const [recentWorkspacePaths, setRecentWorkspacePaths] = useState(() =>
    recentWorkspaces(
      window.localStorage.getItem(workspacePathKey) ?? project.root,
      readRecentWorkspaces(recentWorkspacePathsKey),
    )
  )
  const [projectDiscoveryComplete, setProjectDiscoveryComplete] = useState(false)
  const [projectWorkspaces, setProjectWorkspaces] = useState<Record<string, GitProject>>({})
  const [selectedId, setSelectedId] = useState('')
  const [creatingSession, setCreatingSession] = useState(false)
  const sessionsRef = useRef(sessions)
  const recentSessionsRef = useRef(recentSessions)
  const sentSessionsRef = useRef(sentSessions)
  const completedSessionIdsRef = useRef(completedSessionIds)
  const selectedIdRef = useRef(selectedId)
  const creatingSessionRef = useRef(false)
  const transientNewSessionIdRef = useRef<string | null>(null)
  const refreshVersionRef = useRef(0)
  const autoSelectOnRefreshRef = useRef(true)
  sessionsRef.current = sessions
  recentSessionsRef.current = recentSessions
  sentSessionsRef.current = sentSessions
  completedSessionIdsRef.current = completedSessionIds
  selectedIdRef.current = selectedId

  useEffect(() => () => {
    const transientId = transientNewSessionIdRef.current
    if (transientId) void requestCloseSession(transientId).catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true
    setProjectDiscoveryComplete(false)
    void getGitProject(project.root)
      .then((details) => {
        if (active) setProjectWorkspaces({ [project.root]: details })
      })
      .catch(onError)
      .finally(() => active && setProjectDiscoveryComplete(true))
    return () => {
      active = false
    }
  }, [onError, project.root])

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

  /** Reloads sessions while discarding responses superseded by a newer workspace refresh. */
  const refreshSessions = useCallback(async (cwd = workspacePath) => {
    const version = ++refreshVersionRef.current
    const shouldAutoSelect = autoSelectOnRefreshRef.current
    setIsRefreshingSessions(true)
    try {
      const discoveredWorkspacePaths = Object.values(projectWorkspaces).flatMap((project) =>
        project.workspaces.map((workspace) => workspace.path)
      )
      const workspacePaths = [
        ...new Set(
          discoveredWorkspacePaths.length > 0 ? discoveredWorkspacePaths : [cwd],
        ),
      ]
      const [listedSessions, recentSessionLists] = await Promise.all([
        listSessions(),
        Promise.all(
          workspacePaths.map((path) => listRecentSessions(path)),
        ),
      ])
      const nextRecentSessions = recentSessionLists.flat()
      if (version !== refreshVersionRef.current) return
      let nextSessions = listedSessions
      let autoSelectId: string | undefined
      if (shouldAutoSelect) {
        const target = newestWorkspaceSession(
          sidebarSessions(nextRecentSessions, cwd, sentSessionsRef.current),
          nextSessions,
        )
        if (target?.activeSessionId) autoSelectId = target.activeSessionId
        else if (target) {
          const opened = await requestOpenSession(cwd, target.sessionPath)
          if (version !== refreshVersionRef.current) return
          nextSessions = [
            ...nextSessions.filter((session) =>
              session.id !== opened.id && session.sessionPath !== opened.sessionPath
            ),
            opened,
          ]
          autoSelectId = opened.id
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
      if (version === refreshVersionRef.current) onError(cause)
    } finally {
      if (version === refreshVersionRef.current) setIsRefreshingSessions(false)
    }
  }, [onError, onSessionsRefreshed, projectWorkspaces, workspacePath])

  useEffect(() => {
    if (!projectDiscoveryComplete) return
    void refreshSessions()
  }, [projectDiscoveryComplete, refreshSessions])

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
    const nextRecentWorkspacePaths = recentWorkspaces(path, recentWorkspacePaths)
    window.localStorage.setItem(
      recentWorkspacePathsKey,
      JSON.stringify(nextRecentWorkspacePaths),
    )
    setRecentWorkspacePaths(nextRecentWorkspacePaths)
    discardTransientNewSession(targetSessionId)
    onWorkspaceSelected()
    setWorkspacePath(path)
    setSelectedId(targetSessionId ?? '')
    autoSelectOnRefreshRef.current = targetSessionId === undefined
    void refreshSessions(path)
  }, [
    discardTransientNewSession,
    onWorkspaceSelected,
    recentWorkspacePaths,
    recentWorkspacePathsKey,
    refreshSessions,
    workspacePathKey,
  ])

  // A removed worktree can remain in localStorage after Git prunes it; fall back to a live one.
  useEffect(() => {
    const availableWorkspaces = Object.values(projectWorkspaces).flatMap((project) =>
      project.workspaces.map((workspace) => workspace.path)
    )
    if (availableWorkspaces.length > 0 && !availableWorkspaces.includes(workspacePath))
      selectWorkspace(availableWorkspaces[0])
  }, [projectWorkspaces, selectWorkspace, workspacePath])

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
    refreshSessions,
    removePendingRequest,
    retainNewSession,
    renameManagedSession,
    renameSession,
    selectCreatedSession,
    selectedId,
    sentSessions,
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
