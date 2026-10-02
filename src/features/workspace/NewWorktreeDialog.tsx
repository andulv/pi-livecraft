import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

interface NewWorktreeDialogProps {
  onClose: () => void
  onConfirm: (branch: string) => Promise<void>
}

/** Collects a branch name and creates a worktree for it, started from the main branch. */
export function NewWorktreeDialog({ onClose, onConfirm }: NewWorktreeDialogProps) {
  const [branch, setBranch] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const dialogRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    inputRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLFormElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!creating) onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const normalized = branch.trim()
    if (!normalized) {
      setError('A branch name is required.')
      inputRef.current?.focus()
      return
    }
    setError('')
    setCreating(true)
    try {
      await onConfirm(normalized)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the worktree.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className='modal-backdrop'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !creating) onClose()
      }}
    >
      <form
        aria-describedby={error ? 'new-worktree-error' : undefined}
        aria-labelledby='new-worktree-title'
        aria-modal='true'
        className='modal session-rename-modal'
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        ref={dialogRef}
        role='dialog'
      >
        <h2 id='new-worktree-title'>New worktree</h2>
        <p>Creates a branch and a worktree for it, started from the main branch.</p>
        <label className='session-rename-label' htmlFor='new-worktree-input'>
          Branch name
        </label>
        <input
          aria-invalid={Boolean(error)}
          className='session-rename-input'
          disabled={creating}
          id='new-worktree-input'
          placeholder='feature/my-change'
          ref={inputRef}
          type='text'
          value={branch}
          onChange={(event) => {
            setBranch(event.target.value)
            if (error) setError('')
          }}
        />
        {error && (
          <p className='session-rename-error' id='new-worktree-error' role='alert'>{error}</p>
        )}
        <div className='modal-actions'>
          <button disabled={creating} onClick={onClose} type='button'>
            Cancel
          </button>
          <button className='primary' disabled={creating} type='submit'>
            {creating ? 'Creating…' : 'Create worktree'}
          </button>
        </div>
      </form>
    </div>
  )
}
