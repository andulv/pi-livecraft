import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

interface SessionRenameDialogProps {
  initialName: string
  onClose: () => void
  onConfirm: (name: string) => Promise<void>
}

/** Edits a session title without exposing the process lifecycle to the UI. */
export function SessionRenameDialog(
  { initialName, onClose, onConfirm }: SessionRenameDialogProps,
) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const dialogRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => previousFocusRef.current?.focus()
  }, [])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLFormElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!saving) onClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), '
        + 'textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
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
    const normalized = name.trim()
    if (!normalized) {
      setError('A session name is required.')
      inputRef.current?.focus()
      return
    }
    if (normalized.length > 120) {
      setError('The name cannot exceed 120 characters.')
      inputRef.current?.focus()
      return
    }
    setError('')
    setSaving(true)
    try {
      await onConfirm(normalized)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to rename the session.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className='modal-backdrop session-rename-backdrop'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <form
        aria-describedby={error ? 'session-rename-error' : undefined}
        aria-labelledby='session-rename-title'
        aria-modal='true'
        className='modal session-rename-modal'
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        ref={dialogRef}
        role='dialog'
      >
        <h2 id='session-rename-title'>Rename session</h2>
        <p>Choose a name that is easy to find in your history.</p>
        <label className='session-rename-label' htmlFor='session-rename-input'>
          Session name
        </label>
        <input
          aria-invalid={Boolean(error)}
          className='session-rename-input'
          disabled={saving}
          id='session-rename-input'
          maxLength={120}
          ref={inputRef}
          type='text'
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (error) setError('')
          }}
        />
        {error && (
          <p className='session-rename-error' id='session-rename-error' role='alert'>{error}</p>
        )}
        <div className='modal-actions'>
          <button disabled={saving} onClick={onClose} type='button'>
            Cancel
          </button>
          <button className='primary' disabled={saving} type='submit'>
            {saving ? 'Renaming…' : 'Rename'}
          </button>
        </div>
      </form>
    </div>
  )
}
