interface SessionStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export function archivedSessionsStorageKey(projectId: string): string {
  return `pi-livecraft.project-archived-sessions.${projectId}`
}

/** Reads valid, path-unique archived sessions without trusting browser storage. */
export function readArchivedSessionPaths(
  storage: Pick<SessionStorage, 'getItem'>,
  projectId: string,
): string[] {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(archivedSessionsStorageKey(projectId)) ?? '[]',
    )
    if (!Array.isArray(value)) return []
    return [
      ...new Set(
        value.filter((path): path is string => typeof path === 'string' && path.length > 0),
      ),
    ]
  } catch {
    return []
  }
}

export function writeArchivedSessionPaths(
  storage: Pick<SessionStorage, 'removeItem' | 'setItem'>,
  projectId: string,
  paths: readonly string[],
): void {
  try {
    const key = archivedSessionsStorageKey(projectId)
    if (paths.length === 0) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(paths))
  } catch {
    // Storage can be unavailable in private browsing; archives still work for this tab.
  }
}

/** Archives a session path or restores it when it is already archived. */
export function toggleArchivedSessionPath(paths: readonly string[], sessionPath: string): string[] {
  return paths.includes(sessionPath)
    ? paths.filter((path) => path !== sessionPath)
    : [sessionPath, ...paths]
}
