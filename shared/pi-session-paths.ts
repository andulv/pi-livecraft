/**
 * How Pi names the per-workspace folder that holds session files.
 *
 * Shared because two processes need the same rule: the backend scans these
 * folders to list recent sessions, and the `research` extension locates the
 * session file a subagent child just created. Kept free of Node imports so the
 * frontend build can include it.
 */

/**
 * Pi stores sessions in a deterministic subfolder named after the workspace
 * path: the leading separator is dropped and each remaining separator becomes
 * `-`, wrapped in double dashes.
 */
export function workspaceSessionFolderName(cwd: string): string {
  const segments = cwd.split(/[/\\]+/).filter(Boolean)
  return `--${segments.join('-')}--`
}
