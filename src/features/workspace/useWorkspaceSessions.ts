import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closeSession as requestCloseSession,
  getGitProject,
  listDirectories,
  listRecentSessions,
  listSessions,
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
import { recentWorkspaces } from './recent-workspaces.ts'
import { projectFromGit, readProjects, writeProjects, type Project } from './projects.ts'
import {
  nextActiveSessionId,
  pickSessionOnOpen,
  sidebarSessions,
  type SessionActionTarget,
} from './sidebar-sessions.ts'

interface WorkspaceSessionsOptions {
  onDraftMessage: (sessionId: string, message: string) => void
  onError: (cause: unknown) => void
  onInitialMessageSent: () => void
  onSessionsRefreshed: (sessions: SessionSummary[]) => void
  onWorkspaceSelected: () => void
}

interface StartSessionOptions {
  draftMessage?: string
  initialMessage?: string
}

const COMPLETED_SESSIONS_KEY = 'pi-livecraft.completed-sessions'
const MAX_COMPLETED_SESSIONS = 30

/** Owns workspace selection, session lists, persistence, and session creation. */
export function useWorkspaceSessions(
  { onDraftMessage, onError, onInitialMessageSent, onSessionsRefreshed, onWorkspaceSelected }:
    WorkspaceSessionsOptions,
) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])
  const [sentSessions, setSentSessions] = useState<RecentSession[]>([])
  const [completedSessionIds, setCompletedSessionIds] = useState<ReadonlySet<string>>(
    readCompletedSessionIds,
  )
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(true)
  const [workspacePath, setWorkspacePath] = useState(() =>
    window.localStorage.getItem('pi-livecraft.workspace-path') ?? '.'
  )
  const [recentWorkspacePaths, setRecentWorkspacePaths] = useState(() =>
    recentWorkspaces(
      window.localStorage.getItem('pi-livecraft.workspace-path') ?? '.',
      readRecentWorkspaces(),
    )
  )
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>(readProjects)
  const [projectDiscoveryComplete, setProjectDiscoveryComplete] = useState(() =>
    projects.length === 0
  )
  const [projectWorkspaces, setProjectWorkspaces] = useState<Record<string, GitProject>>({})
  const [selectedId, setSelectedId] = useState('')
  const [creatingSession, setCreatingSession] = useState(false)
  const sessionsRef = useRef(sessions)
  const recentSessionsRef = useRef(recentSessions)
  const sentSessionsRef = useRef(sentSessions)
  const completedSessionIdsRef = useRef(completedSessionIds)
  const selectedIdRef = useRef(selectedId)
  const creatingSessionRef = useRef(false)
  const refreshVersionRef = useRef(0)
  const autoSelectOnRefreshRef = useRef(true)
  sessionsRef.current = sessions
  recentSessionsRef.current = recentSessions
  sentSessionsRef.current = sentSessions
  completedSessionIdsRef.current = completedSessionIds
  selectedIdRef.current = selectedId

  useEffect(() => writeProjects(projects), [projects])

  useEffect(() => {
    let active = true
    void Promise
      .all(
        projects.map(async (project) => [project.root, await getGitProject(project.root)] as const),
      )
      .then((entries) => active && setProjectWorkspaces(Object.fromEntries(entries)))
      .catch(onError)
      .finally(() => active && setProjectDiscoveryComplete(true))
    return () => {
      active = false
    }
  }, [onError, projects])

  useEffect(() => {
    if (window.localStorage.getItem('pi-livecraft.workspace-path') !== null) return
    let active = true
    void listDirectories('.')
      .then(({ path }) => {
        if (!active || window.localStorage.getItem('pi-livecraft.workspace-path') !== null) return
        setWorkspacePath(path)
        setRecentWorkspacePaths(recentWorkspaces(path, readRecentWorkspaces()))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

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

  useEffect(() => writeCompletedSessionIds(completedSessionIds), [completedSessionIds])

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
      const [nextSessions, recentSessionLists] = await Promise.all([
        listSessions(),
        Promise.all(
          workspacePaths.map((path) => listRecentSessions(path).catch(() => [])),
        ),
      ])
      const nextRecentSessions = recentSessionLists.flat()
      if (version !== refreshVersionRef.current) return
      const autoSelectId = shouldAutoSelect
        ? pickSessionOnOpen(
          sidebarSessions(nextRecentSessions, cwd, sentSessionsRef.current),
          nextSessions,
          completedSessionIdsRef.current,
        )
        : undefined
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

  /** Selects a workspace, optionally preserving an explicit session over automatic selection. */
  const selectWorkspace = useCallback((path: string, targetSessionId?: string): void => {
    window.localStorage.setItem('pi-livecraft.workspace-path', path)
    const nextRecentWorkspacePaths = recentWorkspaces(path, recentWorkspacePaths)
    window.localStorage.setItem(
      'pi-livecraft.recent-workspace-paths',
      JSON.stringify(nextRecentWorkspacePaths),
    )
    setRecentWorkspacePaths(nextRecentWorkspacePaths)
    onWorkspaceSelected()
    setWorkspacePath(path)
    setSelectedId(targetSessionId ?? '')
    setDirectoryPickerOpen(false)
    autoSelectOnRefreshRef.current = targetSessionId === undefined
    void refreshSessions(path)
  }, [onWorkspaceSelected, recentWorkspacePaths, refreshSessions])

  // A removed worktree can remain in localStorage after Git prunes it; fall back to a live one.
  useEffect(() => {
    const availableWorkspaces = Object.values(projectWorkspaces).flatMap((project) =>
      project.workspaces.map((workspace) => workspace.path)
    )
    if (availableWorkspaces.length > 0 && !availableWorkspaces.includes(workspacePath))
      selectWorkspace(availableWorkspaces[0])
  }, [projectWorkspaces, selectWorkspace, workspacePath])

  /** Adds a Git repository and selects its main workspace. */
  const addProject = useCallback((project: GitProject): void => {
    const nextProject = projectFromGit(project)
    setProjects((current) => [nextProject, ...current.filter(({ root }) => root !== project.root)])
    setProjectWorkspaces((current) => ({ ...current, [project.root]: project }))
    selectWorkspace(project.workspaces.find(({ main }) => main)?.path ?? project.root)
  }, [selectWorkspace])

  /** Removes the project from the sidebar without touching its repository or Pi histories. */
  const removeProject = useCallback((root: string): void => {
    setProjects((current) => current.filter((project) => project.root !== root))
    setProjectWorkspaces((current) => {
      const { [root]: _removed, ...rest } = current
      return rest
    })
  }, [])

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

  /** Launches and selects a session, then sends or prepares its optional first prompt.
   *  Returns the created session summary, or null when an error prevented the operation. */
  const startAndSelectSession = useCallback(
    async (
      start: () => Promise<SessionSummary>,
      options: StartSessionOptions = {},
    ): Promise<SessionSummary | null> => {
      creatingSessionRef.current = true
      setCreatingSession(true)
      setSelectedId('')
      try {
        const session = await start()
        await refreshSessions()
        setSelectedId(session.id)
        if (options.draftMessage) onDraftMessage(session.id, options.draftMessage)
        if (options.initialMessage) {
          await sendPiCommand(session.id, { type: 'prompt', message: options.initialMessage })
          nameSessionFromFirstPrompt(session, options.initialMessage)
          await refreshSessions()
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
    [nameSessionFromFirstPrompt, onDraftMessage, onError, onInitialMessageSent, refreshSessions],
  )

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
  }, [])

  /** Renames through the persisted-session RPC so the name survives new browser tabs. */
  const renameManagedSession = useCallback(
    async (target: SessionActionTarget, name: string): Promise<void> => {
      const normalized = name.trim()
      if (!normalized) throw new Error('Session name is required')
      if (!target.sessionPath) throw new Error('Session path is unavailable')
      await renameStoredSession(target.cwd, target.sessionPath, normalized)
      if (target.sessionId) renameSession(target.sessionId, normalized)
      await refreshSessions()
    },
    [refreshSessions, renameSession],
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
    addProject,
    closeManagedSession,
    completedSessionIds,
    creatingSession,
    directoryPickerOpen,
    isRefreshingSessions,
    markSessionCompleted,
    nameSessionFromFirstPrompt,
    projectWorkspaces,
    projects,
    recentSessions,
    recentWorkspacePaths,
    refreshSessions,
    removePendingRequest,
    removeProject,
    renameManagedSession,
    renameSession,
    selectCreatedSession,
    selectedId,
    sentSessions,
    sessions,
    setDirectoryPickerOpen,
    setSelectedId,
    selectWorkspace,
    startAndSelectSession,
    updateSession,
    workspacePath,
  }
}

/** Reads the persisted list of recent workspace paths from localStorage. */
function readRecentWorkspaces(): string[] {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem('pi-livecraft.recent-workspace-paths') ?? '[]',
    )
    return Array.isArray(value)
      ? value.filter((path): path is string => typeof path === 'string')
      : []
  } catch {
    return []
  }
}

/** Restores completed-session identifiers persisted across same-tab refreshes. */
function readCompletedSessionIds(): ReadonlySet<string> {
  try {
    const stored = sessionStorage.getItem(COMPLETED_SESSIONS_KEY)
    if (!stored) return new Set()
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return new Set()
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
    return keepRecentCompletedSessionIds(ids)
  } catch {
    return new Set()
  }
}

/** Persists completed-session identifiers so they survive a page refresh within the same tab. */
function writeCompletedSessionIds(ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) sessionStorage.removeItem(COMPLETED_SESSIONS_KEY)
    else sessionStorage.setItem(
        COMPLETED_SESSIONS_KEY,
        JSON.stringify([...keepRecentCompletedSessionIds(ids)]),
      )
  } catch {
    // sessionStorage may be unavailable
  }
}

function keepRecentCompletedSessionIds(ids: Iterable<string>): ReadonlySet<string> {
  return new Set([...ids].slice(-MAX_COMPLETED_SESSIONS))
}
