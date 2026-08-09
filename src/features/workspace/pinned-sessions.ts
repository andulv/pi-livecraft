import type { RecentSession } from '../../../shared/types.ts'

interface SessionStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export function pinnedSessionsStorageKey(projectId: string): string {
  return `pi-livecraft.project-pinned-sessions.${projectId}`
}

/** Reads valid, path-unique project pins without trusting browser storage. */
export function readPinnedSessions(
  storage: Pick<SessionStorage, 'getItem'>,
  projectId: string,
): RecentSession[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(pinnedSessionsStorageKey(projectId)) ?? '[]')
    if (!Array.isArray(value)) return []
    const paths = new Set<string>()
    return value.flatMap((candidate): RecentSession[] => {
      if (!isPinnedSession(candidate) || paths.has(candidate.sessionPath)) return []
      paths.add(candidate.sessionPath)
      return [candidate]
    })
  } catch {
    return []
  }
}

export function writePinnedSessions(
  storage: Pick<SessionStorage, 'removeItem' | 'setItem'>,
  projectId: string,
  sessions: RecentSession[],
): void {
  try {
    const key = pinnedSessionsStorageKey(projectId)
    if (sessions.length === 0) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(sessions))
  } catch {
    // Storage can be unavailable in private browsing; in-memory pins still work for this tab.
  }
}

/** Adds a pin to the front or removes the existing pin for the same session path. */
export function togglePinnedSession(
  pinnedSessions: RecentSession[],
  session: RecentSession,
): RecentSession[] {
  const pinned = pinnedSessions.some(({ sessionPath }) => sessionPath === session.sessionPath)
  return pinned
    ? pinnedSessions.filter(({ sessionPath }) => sessionPath !== session.sessionPath)
    : [session, ...pinnedSessions]
}

/** Refreshes pin metadata while preserving explicit pin order and unavailable saved pins. */
export function resolvePinnedSessions(
  pinnedSessions: RecentSession[],
  recentSessions: readonly RecentSession[],
  sentSessions: readonly RecentSession[] = [],
): RecentSession[] {
  const currentByPath = new Map(
    [...sentSessions, ...recentSessions].map((session) => [session.sessionPath, session]),
  )
  return pinnedSessions.map((pinned) => currentByPath.get(pinned.sessionPath) ?? pinned)
}

function isPinnedSession(value: unknown): value is RecentSession {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RecentSession>
  return typeof candidate.id === 'string'
    && typeof candidate.cwd === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.sessionPath === 'string'
    && typeof candidate.updatedAt === 'number'
    && Number.isFinite(candidate.updatedAt)
}
