import { useState, type CSSProperties } from 'react'
import type { GitProject } from '../../../shared/types.ts'
import { ProjectPicker } from './ProjectPicker.tsx'
import type { Project } from './projects.ts'

interface ProjectHomeProps {
  activity: Record<string, number>
  details: Record<string, GitProject>
  projects: Project[]
  isDiscovering: boolean
  unavailableProjectIds: ReadonlySet<string>
  onAdd: (project: GitProject) => Project
  onOpen: (project: Project) => void
  onRemove: (projectId: string) => void
}

/** Entry screen for choosing or registering a local Git project. */
export function ProjectHome({
  activity,
  details,
  projects,
  isDiscovering,
  unavailableProjectIds,
  onAdd,
  onOpen,
  onRemove,
}: ProjectHomeProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState('')

  return (
    <main className='project-home'>
      <header className='project-home-header'>
        <div className='project-home-brand'>
          <span className='brand-mark'>π</span>
          <div>
            <strong>Pi Livecraft</strong>
            <span>
              {projects.length > 0 ? 'Choose a project to continue' : 'Add a project to begin'}
            </span>
          </div>
        </div>
        {projects.length > 0 && (
          <button
            className='project-home-add'
            onClick={() => setPickerOpen(true)}
            type='button'
          >
            ＋ Add project
          </button>
        )}
      </header>

      {error && <p className='project-home-error' role='alert'>{error}</p>}
      {projects.length > 0
        ? (
          <section aria-label='Registered projects' className='project-card-grid'>
            {[...projects]
              .sort((left, right) => (activity[right.id] ?? 0) - (activity[left.id] ?? 0))
              .map((project) => {
                const unavailable = unavailableProjectIds.has(project.id)
                const checking = isDiscovering && !details[project.id]
                const workspaceCount = details[project.id]?.workspaces.length
                return (
                  <article
                    className={`project-card${unavailable ? ' unavailable' : ''}`}
                    key={project.id}
                    style={{ '--project-color': project.color } as CSSProperties}
                  >
                    <button
                      className='project-card-open'
                      disabled={unavailable || checking}
                      onClick={() => onOpen(project)}
                      type='button'
                    >
                      <span className='project-card-name'>{project.name}</span>
                      <span className='project-card-path'>{project.root}</span>
                      <span className='project-card-meta'>
                        {checking
                          ? 'Checking repository…'
                          : unavailable
                          ? 'Repository unavailable'
                          : `${workspaceCount ?? 1} workspace${workspaceCount === 1 ? '' : 's'}`}
                      </span>
                    </button>
                    <button
                      aria-label={`Remove ${project.name}`}
                      className='project-card-remove'
                      onClick={() => onRemove(project.id)}
                      type='button'
                    >
                      Remove
                    </button>
                  </article>
                )
              })}
          </section>
        )
        : (
          <section className='project-home-empty'>
            <strong>No projects registered</strong>
            <p>Add a local Git repository to create your first Livecraft project.</p>
            <button onClick={() => setPickerOpen(true)} type='button'>Add project</button>
          </section>
        )}

      {pickerOpen && (
        <ProjectPicker
          onClose={() => setPickerOpen(false)}
          onError={(cause) => setError(cause instanceof Error ? cause.message : String(cause))}
          onSelect={(gitProject) => {
            setPickerOpen(false)
            onOpen(onAdd(gitProject))
          }}
        />
      )}
    </main>
  )
}
