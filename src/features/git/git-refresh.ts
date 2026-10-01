/**
 * Pi's built-in tools that only read the workspace. Their completion cannot change Git state,
 * so it does not schedule a Git refresh; every other tool (`bash`, `edit`, `write`, extension
 * and sub-agent tools) may change files and does.
 */
const readOnlyTools = new Set(['read', 'grep', 'find', 'ls'])

/** Whether a finished tool call can have changed the workspace's Git state. */
export function toolMayChangeGitState(toolName: unknown): boolean {
  return typeof toolName !== 'string' || !readOnlyTools.has(toolName)
}
