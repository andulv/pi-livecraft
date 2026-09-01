/** Browser instance ID of the pane's primary tab (further IDs arrive later). */
export const primaryBrowserId = 'main'

/** Local port range reserved for deterministic per-instance debug endpoints. */
export const browserDebugPortBase = 45_000
export const browserDebugPortSpan = 1_000

/**
 * Deterministic debug port for one browser instance (djb2 hash of the canonical
 * workspace path and browser ID). Stable across restarts, so environment
 * describing a workspace's browser (`LIVECRAFT_BROWSER_URL`) keeps pointing at
 * that workspace's browser. Shared by the backend service and the manager's
 * Pi spawn code; keep free of imports so both runtimes stay lean.
 */
export function browserDebugPortFor(workspacePath: string, browserId: string): number {
  let hash = 5381
  for (const char of `${workspacePath}\u0000${browserId}`) {
    hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0
  }
  return browserDebugPortBase + (hash % browserDebugPortSpan)
}
