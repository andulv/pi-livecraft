import { useCallback, useEffect, useState } from 'react'
import type { GitProject } from '../../../shared/types.ts'
import { getGitProject, listRecentSessions } from '../../api.ts'
import { projectFromGit, readProjects, writeProjects, type Project } from './projects.ts'

/** Owns the browser's project registry independently from any open Livecraft project view. */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>(readProjects)
  const [isDiscovering, setIsDiscovering] = useState(() => projects.length > 0)
  const [projectActivity, setProjectActivity] = useState<Record<string, number>>({})
  const [projectDetails, setProjectDetails] = useState<Record<string, GitProject>>({})
  const [unavailableProjectIds, setUnavailableProjectIds] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => writeProjects(projects), [projects])

  const refreshProjects = useCallback(async (): Promise<void> => {
    const results = await Promise.all(projects.map(async (project) => {
      try {
        const details = await getGitProject(project.root)
        const recent = await Promise.all(
          details.workspaces.map(({ path }) => listRecentSessions(path).catch(() => [])),
        )
        const activity = recent.flat().reduce(
          (latest, session) => Math.max(latest, session.updatedAt),
          0,
        )
        return { project, details, activity }
      } catch {
        return { project, details: null, activity: 0 }
      }
    }))
    setProjectDetails(Object.fromEntries(
      results.flatMap(({ project, details }) => details ? [[project.id, details]] : []),
    ))
    setProjectActivity(Object.fromEntries(
      results.map(({ project, activity }) => [project.id, activity]),
    ))
    setUnavailableProjectIds(
      new Set(
        results.flatMap(({ project, details }) => details ? [] : [project.id]),
      ),
    )
    setIsDiscovering(false)
  }, [projects])

  const addProject = useCallback((details: GitProject): Project => {
    const project = projectFromGit(details, projects)
    setProjects((current) => [project, ...current.filter(({ root }) => root !== project.root)])
    setProjectActivity((current) => ({ ...current, [project.id]: 0 }))
    setProjectDetails((current) => ({ ...current, [project.id]: details }))
    setUnavailableProjectIds((current) => {
      const next = new Set(current)
      next.delete(project.id)
      return next
    })
    return project
  }, [projects])

  const removeProject = useCallback((projectId: string): void => {
    setProjects((current) => current.filter(({ id }) => id !== projectId))
    setProjectActivity((current) => {
      const { [projectId]: _removed, ...rest } = current
      return rest
    })
    setProjectDetails((current) => {
      const { [projectId]: _removed, ...rest } = current
      return rest
    })
  }, [])

  return {
    addProject,
    isDiscovering,
    projectActivity,
    projectDetails,
    projects,
    refreshProjects,
    removeProject,
    unavailableProjectIds,
  }
}
