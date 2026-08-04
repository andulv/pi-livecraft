import { useEffect, useRef, useState, type FormEvent } from 'react'

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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || saving) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, saving])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const normalized = name.trim()
    if (!normalized) {
      setError('Le nom de la session est requis.')
      inputRef.current?.focus()
      return
    }
    if (normalized.length > 120) {
      setError('Le nom ne peut pas dépasser 120 caractères.')
      inputRef.current?.focus()
      return
    }
    setError('')
    setSaving(true)
    try {
      await onConfirm(normalized)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de renommer la session.')
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
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        role='dialog'
      >
        <h2 id='session-rename-title'>Renommer la session</h2>
        <p>Choisissez un nom facile à retrouver dans votre historique.</p>
        <label className='session-rename-label' htmlFor='session-rename-input'>
          Nom de la session
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
            Annuler
          </button>
          <button className='primary' disabled={saving} type='submit'>
            {saving ? 'Renommage…' : 'Renommer'}
          </button>
        </div>
      </form>
    </div>
  )
}
