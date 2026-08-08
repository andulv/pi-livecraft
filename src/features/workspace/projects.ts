import type { GitProject } from '../../../shared/types.ts'

export interface Project {
  id: string
  name: string
  root: string
}

export const PROJECTS_KEY = 'pi-livecraft.projects'

/** Creates the persisted project record from the repository identity returned by the backend. */
export function projectFromGit(project: GitProject): Project {
  const segments = project.root.replaceAll('\\', '/').split('/').filter(Boolean)
  return { id: project.root, name: segments.at(-1) ?? project.root, root: project.root }
}

export function readProjects(): Project[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PROJECTS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isProject)
  } catch {
    return []
  }
}

export function writeProjects(projects: readonly Project[]): void {
  window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
}

function isProject(value: unknown): value is Project {
  return typeof value === 'object' && value !== null
    && typeof (value as Project).id === 'string'
    && typeof (value as Project).name === 'string'
    && typeof (value as Project).root === 'string'
}
