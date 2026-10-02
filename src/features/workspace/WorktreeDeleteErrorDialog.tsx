import { useEffect, useRef } from 'react'

interface WorktreeDeleteErrorDialogProps {
  /** Branch or path shown in the title so the user knows which worktree failed. */
  label: string
  message: string
  onClose: () => void
}

/**
 * Presents a failed worktree deletion in a dialog rather than a transient toast, because Git's
 * error text can be long or opaque. A plain-language explanation is shown when the message
 * matches a known cause, and the raw Git output is always available below it.
 */
export function WorktreeDeleteErrorDialog(
  { label, message, onClose }: WorktreeDeleteErrorDialogProps,
) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    closeRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [])

  const explanation = explainWorktreeDeleteError(message)

  return (
    <div
      className='modal-backdrop'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        aria-labelledby='worktree-delete-error-title'
        aria-modal='true'
        className='modal'
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        role='alertdialog'
      >
        <h2 id='worktree-delete-error-title'>Couldn't delete {label}</h2>
        {explanation && <p>{explanation}</p>}
        <p className='worktree-delete-error-label'>Git reported</p>
        <pre className='worktree-delete-error-detail'>{message}</pre>
        <div className='modal-actions'>
          <button className='primary' onClick={onClose} ref={closeRef} type='button'>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/** Maps a known Git failure to a plain-language explanation, or nothing when unrecognized. */
function explainWorktreeDeleteError(message: string): string | undefined {
  if (/uncommitted changes/i.test(message))
    return 'The worktree still has uncommitted changes. Commit or discard them, then delete it again.'
  if (/not merged into/i.test(message))
    return 'The worktree has commits that are not on the main branch yet. Merge or remove them first so no work is lost.'
  if (/locked working tree/i.test(message))
    return 'Git has this worktree locked. Unlock it (git worktree unlock) before deleting it.'
  if (/submodules/i.test(message))
    return 'This worktree contains submodules that Git would not remove automatically.'
  return undefined
}
