/**
 * How a subagent run is recognized once it is only a session file.
 *
 * The `research` extension names every child session with this prefix and an
 * owner id. The frontend uses the same rule to keep unowned runs out of the
 * session list and to nest owned runs below their parent. Shared so producer
 * and consumer cannot drift apart.
 */

export const SUBAGENT_SESSION_PREFIX = 'subagent/'
const OWNER_MARKER = /^subagent\/([^/]+)\/(.+)$/

/** Builds the persisted child name while keeping the owner recoverable later. */
export function subagentSessionName(ownerSessionId: string, task: string): string {
  return `${SUBAGENT_SESSION_PREFIX}${ownerSessionId}/research: ${task}`
}

/** Reports whether a session name marks it as a subagent run. */
export function isSubagentSessionName(name: string): boolean {
  return name.startsWith(SUBAGENT_SESSION_PREFIX)
}

/** Returns the parent session id embedded in a marked child name. */
export function subagentOwnerSessionId(name: string): string | undefined {
  return OWNER_MARKER.exec(name)?.[1]
}

/** Hides the internal owner marker from the session-list label. */
export function subagentDisplayName(name: string): string {
  const match = OWNER_MARKER.exec(name)
  return match ? `${SUBAGENT_SESSION_PREFIX}${match[2]}` : name
}

/** Extracts Pi's session id from its persisted filename. */
export function sessionIdFromFilePath(path: string | undefined): string | undefined {
  if (!path) return undefined
  const fileName = path.split(/[\\/]/).pop() ?? ''
  return /_([^_]+)\.jsonl$/.exec(fileName)?.[1]
}
