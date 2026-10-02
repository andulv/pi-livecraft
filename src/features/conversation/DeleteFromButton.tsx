import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'

interface DeleteFromButtonProps {
  entryId: string
  onError: (cause: unknown) => void
  onDelete: (entryId: string) => Promise<boolean>
}

/** Drops a prompt and everything after it; the first click arms the button and must be confirmed. */
export function DeleteFromButton({ entryId, onError, onDelete }: DeleteFromButtonProps) {
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const armTimerRef = useRef(0)

  useEffect(() => () => window.clearTimeout(armTimerRef.current), [])

  useEffect(() => {
    if (!cancelled) return
    const timeout = window.setTimeout(() => setCancelled(false), 1500)
    return () => window.clearTimeout(timeout)
  }, [cancelled])

  async function deleteFromEntry(): Promise<void> {
    setBusy(true)
    setArmed(false)
    try {
      if (!await onDelete(entryId)) setCancelled(true)
    } catch (cause) {
      onError(cause)
    } finally {
      setBusy(false)
    }
  }

  function onButtonClick(): void {
    if (armed) {
      window.clearTimeout(armTimerRef.current)
      void deleteFromEntry()
      return
    }
    setArmed(true)
    window.clearTimeout(armTimerRef.current)
    armTimerRef.current = window.setTimeout(() => setArmed(false), 3000)
  }

  const label = busy
    ? 'Deleting conversation'
    : cancelled
    ? 'Delete cancelled'
    : armed
    ? 'Confirm: delete from this message'
    : 'Delete from this message'

  return (
    <Tooltip label={label}>
      <button
        aria-label={label}
        className={armed
          ? 'conversation-action-button delete-from-action armed'
          : 'conversation-action-button delete-from-action'}
        disabled={busy}
        onClick={onButtonClick}
        type='button'
      >
        <svg aria-hidden='true' fill='none' stroke='currentColor' viewBox='0 0 16 16'>
          <path
            d='M3 4.5h10M6.5 4.5V3.2a.7.7 0 0 1 .7-.7h1.6a.7.7 0 0 1 .7.7v1.3M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1M6.7 7v4.2M9.3 7v4.2'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      </button>
    </Tooltip>
  )
}
