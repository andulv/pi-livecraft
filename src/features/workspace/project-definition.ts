import type { GitProject } from '../../../shared/types.ts'

export interface Project {
  id: string
  name: string
  root: string
  color: string
}

const projectColors = [
  '#23776d',
  '#6851a4',
  '#a4573d',
  '#3c6fa8',
  '#8a5b22',
  '#3f7d4e',
  '#9a4770',
  '#596b9d',
] as const

/** Creates a stable browser-local identity and colour from a repository root. */
export function projectFromGit(project: GitProject, existing: readonly Project[] = []): Project {
  const segments = project.root.replaceAll('\\', '/').split('/').filter(Boolean)
  return {
    id: projectId(project.root),
    name: segments.at(-1) ?? project.root,
    root: project.root,
    color: projectColor(project.root, existing.map(({ color }) => color)),
  }
}

/** FNV-1a gives stable URL-safe IDs without exposing local filesystem paths. */
export function projectId(root: string): string {
  let hash = 0x811c9dc5
  for (const character of root) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return `project-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function projectColor(root: string, usedColors: readonly string[] = []): string {
  const numericId = Number.parseInt(projectId(root).slice('project-'.length), 16)
  const start = numericId % projectColors.length
  const ordered = projectColors.map((_, index) =>
    projectColors[(start + index) % projectColors.length]
  )
  return ordered.find((color) => !usedColors.includes(color)) ?? projectColors[0]
}

/** Gives linked worktrees a stable color distinct from their project's main checkout. */
export function worktreeColor(
  projectRoot: string,
  workspacePath: string,
  mainColor: string,
): string {
  if (workspacePath === projectRoot) return mainColor
  return projectColor(workspacePath, [mainColor])
}
