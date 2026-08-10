const projectPathPattern = /^\/project\/([^/]+)$/

export interface ProjectUrlState {
  workspacePath?: string
  sessionPath?: string
}

/** Extracts the selected project id from a path or the legacy `?project=` query. */
export function projectIdFromLocation(pathname: string, search: string): string | null {
  const match = pathname.match(projectPathPattern)
  if (match) return decodeURIComponent(match[1])
  return new URLSearchParams(search).get('project')
}

/** Extracts the workspace and session paths carried as project page query parameters. */
export function projectUrlState(pathname: string, search: string): ProjectUrlState {
  if (!pathname.match(projectPathPattern)) return {}
  const params = new URLSearchParams(search)
  return {
    workspacePath: params.get('workspace') ?? undefined,
    sessionPath: params.get('session') ?? undefined,
  }
}

/** Builds the project page path with optional workspace and session query parameters. */
export function projectPageUrl(
  projectId: string,
  workspacePath?: string,
  sessionPath?: string,
): string {
  const params = new URLSearchParams()
  if (workspacePath) params.set('workspace', workspacePath)
  if (sessionPath) params.set('session', sessionPath)
  const query = params.toString()
  return `/project/${encodeURIComponent(projectId)}${query ? `?${query}` : ''}`
}
