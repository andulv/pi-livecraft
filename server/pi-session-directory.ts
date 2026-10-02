import { homedir } from 'node:os'
import { join } from 'node:path'
import { workspaceSessionFolderName } from '../shared/pi-session-paths.ts'

/** Resolves Pi's session storage using its configured profile before the default profile. */
export function resolvePiSessionDirectory(
  environment: { PI_CODING_AGENT_SESSION_DIR?: string; PI_CODING_AGENT_DIR?: string },
  homeDirectory: string,
): string {
  return environment.PI_CODING_AGENT_SESSION_DIR
    ?? (environment.PI_CODING_AGENT_DIR
      ? join(environment.PI_CODING_AGENT_DIR, 'sessions')
      : join(homeDirectory, '.pi', 'agent', 'sessions'))
}

/** Absolute path of the folder Pi uses for one workspace's sessions. */
export function workspaceSessionDir(cwd: string, baseDir: string): string {
  return join(baseDir, workspaceSessionFolderName(cwd))
}

/** Pi's resolved session directory for this process. */
export const sessionDirectory = resolvePiSessionDirectory(process.env, homedir())
