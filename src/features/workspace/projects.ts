import { projectColor, projectId, type Project } from './project-definition.ts'

export type { Project } from './project-definition.ts'
export { projectFromGit } from './project-definition.ts'

export const PROJECTS_KEY = 'pi-livecraft.projects'

/** Reads projects while migrating path-based IDs and missing colours from earlier releases. */
export function readProjects(): Project[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PROJECTS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const projects = parsed.reduce<Project[]>((current, value) => {
      if (!isLegacyProject(value)) return current
      const storedColor = typeof value.color === 'string' && value.color ? value.color : undefined
      const color = storedColor && !current.some((project) => project.color === storedColor)
        ? storedColor
        : projectColor(value.root, current.map((project) => project.color))
      return [...current, { id: projectId(value.root), name: value.name, root: value.root, color }]
    }, [])
    writeProjects(projects)
    return projects
  } catch {
    return []
  }
}

export function writeProjects(projects: readonly Project[]): void {
  window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
}

function isLegacyProject(value: unknown): value is { name: string; root: string; color?: string } {
  return typeof value === 'object' && value !== null
    && typeof (value as { name?: unknown }).name === 'string'
    && typeof (value as { root?: unknown }).root === 'string'
}
