import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { getGitProject, listDirectories } from '../../api.ts'
import type { GitProject } from '../../../shared/types.ts'
import { directoryCompletionTarget } from './directory-completion.ts'

/** Lets the user add a project only after resolving the selected path to a Git repository. */
export function ProjectPicker({ onClose, onError, onSelect }: {
  onClose: () => void
  onError: (cause: unknown) => void
  onSelect: (project: GitProject) => void
}) {
  const [path, setPath] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [busy, setBusy] = useState(false)
  const completionVersionRef = useRef(0)

  useEffect(() => {
    const version = ++completionVersionRef.current
    const target = directoryCompletionTarget(path)
    if (!target) return setSuggestions([])
    void listDirectories(target.parentPath)
      .then((parent) => {
        if (version !== completionVersionRef.current) return
        setSuggestions(
          parent
            .directories
            .filter(({ name }) => name.startsWith(target.namePrefix))
            .map(({ name }) => `${target.pathPrefix}${name}`),
        )
        setActiveSuggestion(-1)
      })
      .catch(() => version === completionVersionRef.current && setSuggestions([]))
  }, [path])

  function selectProject(nextPath: string): void {
    setBusy(true)
    void getGitProject(nextPath).then(onSelect).catch(onError).finally(() => setBusy(false))
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') return onClose()
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!suggestions.length) return
      event.preventDefault()
      setActiveSuggestion((current) =>
        event.key === 'ArrowDown'
          ? Math.min(current + 1, suggestions.length - 1)
          : Math.max(0, current - 1)
      )
      return
    }
    if (event.key === 'Tab') {
      const suggestion = suggestions[activeSuggestion >= 0 ? activeSuggestion : 0]
      if (suggestion) {
        event.preventDefault()
        setPath(suggestion)
        setActiveSuggestion(-1)
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectProject(path)
    }
  }

  return (
    <div className='modal-backdrop' role='presentation'>
      <section
        aria-labelledby='project-picker-title'
        aria-modal='true'
        className='modal directory-picker'
        role='dialog'
      >
        <h2 id='project-picker-title'>Add project</h2>
        <p>
          Select a local Git repository. Its main checkout and linked worktrees become workspaces.
        </p>
        <label className='directory-path-label' htmlFor='project-path'>Repository path</label>
        <input
          autoComplete='off'
          autoFocus
          aria-autocomplete='list'
          aria-controls={suggestions.length
            ? 'directory-suggestions'
            : undefined}
          aria-expanded={suggestions.length > 0}
          className='directory-path-input'
          id='project-path'
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder='~/projects/repository'
          role='combobox'
          value={path}
        />
        <p className='directory-path-hint'>
          A folder inside the repository is accepted · Tab completes · Enter adds
        </p>
        {suggestions.length > 0 && (
          <div
            aria-label='Directory suggestions'
            className='directory-suggestions'
            id='directory-suggestions'
            role='listbox'
          >
            {suggestions.map((suggestion, index) => (
              <div
                aria-selected={index === activeSuggestion}
                className={index === activeSuggestion ? 'active' : undefined}
                id={`directory-suggestion-${index}`}
                key={suggestion}
                onClick={() => {
                  setPath(suggestion)
                  setActiveSuggestion(-1)
                }}
                onMouseDown={(event) => event.preventDefault()}
                role='option'
              >
                {suggestion}
              </div>
            ))}
          </div>
        )}
        <div className='modal-actions'>
          <button disabled={busy} onClick={onClose} type='button'>Cancel</button>
          <button
            className='primary'
            disabled={busy || !path.trim()}
            onClick={() => selectProject(path)}
            type='button'
          >
            {busy ? 'Adding…' : 'Add project'}
          </button>
        </div>
      </section>
    </div>
  )
}
