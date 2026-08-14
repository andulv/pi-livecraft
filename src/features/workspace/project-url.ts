const projectPathPattern = /^\/project\/([^/]+)$/
const projectHashSuffixPattern = /-([0-9a-f]{8})$/i

export interface ProjectUrlState {
  workspacePath?: string
  sessionPath?: string
}

function projectSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'project'
}

/** Extracts the stable project id from a readable path or legacy `?project=` query. */
export function projectIdFromLocation(pathname: string, search: string): string | null {
  const match = pathname.match(projectPathPattern)
  if (match) {
    const segment = decodeURIComponent(match[1])
    if (segment.startsWith('project-')) return segment
    const suffix = segment.match(projectHashSuffixPattern)?.[1]
    return suffix ? `project-${suffix.toLowerCase()}` : null
  }
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

/** Builds a readable, stable project path with optional workspace and session query parameters. */
export function projectPageUrl(
  projectId: string,
  projectName?: string,
  workspacePath?: string,
  sessionPath?: string,
): string {
  const idSuffix = projectId.startsWith('project-') ? projectId.slice('project-'.length) : projectId
  const segment = projectName ? `${projectSlug(projectName)}-${idSuffix}` : projectId
  const params = new URLSearchParams()
  if (workspacePath) params.set('workspace', workspacePath)
  if (sessionPath) params.set('session', sessionPath)
  const query = params.toString()
  return `/project/${encodeURIComponent(segment)}${query ? `?${query}` : ''}`
}
