import { useEffect, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'

interface ForkButtonProps {
  entryId: string
  onError: (cause: unknown) => void
  onFork: (entryId: string) => Promise<boolean>
}

/** Forks the active Pi session and reports cancellation through its tooltip. */
export function ForkButton({ entryId, onError, onFork }: ForkButtonProps) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<'idle' | 'forked' | 'cancelled'>('idle')

  useEffect(() => {
    if (status === 'idle') return
    const timeout = window.setTimeout(() => setStatus('idle'), 1500)
    return () => window.clearTimeout(timeout)
  }, [status])

  async function forkConversation(): Promise<void> {
    setBusy(true)
    try {
      setStatus(await onFork(entryId) ? 'forked' : 'cancelled')
    } catch (cause) {
      onError(cause)
    } finally {
      setBusy(false)
    }
  }

  const label = busy
    ? 'Forking conversation'
    : status === 'forked'
    ? 'Conversation forked'
    : status === 'cancelled'
    ? 'Fork cancelled'
    : 'Fork conversation from this message'

  return (
    <Tooltip label={label}>
      <button
        aria-label={label}
        className='conversation-action-button'
        disabled={busy}
        onClick={() => void forkConversation()}
        type='button'
      >
        <svg aria-hidden='true' fill='none' stroke='currentColor' viewBox='0 0 16 16'>
          <circle cx='4' cy='3' r='1.5' />
          <circle cx='12' cy='5' r='1.5' />
          <circle cx='4' cy='13' r='1.5' />
          <path d='M4 4.5v7M5.5 9c3.5 0 5-1 5-2.5' strokeLinecap='round' />
        </svg>
      </button>
    </Tooltip>
  )
}
