/**
 * How a subagent run is recognized once it is only a session file.
 *
 * The `research` extension names every child session with this prefix, and the
 * frontend uses the same rule to keep those runs out of the ordinary session
 * list. Shared so the producer and the consumer cannot drift apart.
 */

export const SUBAGENT_SESSION_PREFIX = 'subagent/'

/** Reports whether a session name marks it as a subagent run. */
export function isSubagentSessionName(name: string): boolean {
  return name.startsWith(SUBAGENT_SESSION_PREFIX)
}
