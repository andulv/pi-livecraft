import { useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'

interface OpenShubAgentSessionButtonProps {
  cwd: string
  onError: (cause: unknown) => void
  onOpenSession: (cwd: string, sessionPath: string) => Promise<void>
  sessionPath: string
}

/**
 * Opens the session a shub-agent run persisted, so its transcript, tool calls
 * and cost can be read like any other session. Opening resumes the session
 * through the manager, which also makes it continuable by hand.
 */
export function OpenShubAgentSessionButton({
  cwd,
  onError,
  onOpenSession,
  sessionPath,
}: OpenShubAgentSessionButtonProps) {
  const [busy, setBusy] = useState(false)

  async function open(): Promise<void> {
    setBusy(true)
    try {
      await onOpenSession(cwd, sessionPath)
    } catch (cause) {
      onError(cause)
    } finally {
      setBusy(false)
    }
  }

  const label = busy ? 'Opening shub-agent session…' : 'Open shub-agent session'
  return (
    <Tooltip label={label}>
      <button
        aria-label={label}
        className='conversation-action-button open-shub-agent-session-action'
        disabled={busy}
        onClick={() => void open()}
        type='button'
      >
        <svg aria-hidden='true' viewBox='0 0 16 16'>
          <path
            d='M2.5 4.5h4l1.2 1.5h5.8v6.5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z'
            fill='none'
            stroke='currentColor'
          />
          <path d='M6 9.5h4m-2-2v4' fill='none' stroke='currentColor' strokeLinecap='round' />
        </svg>
      </button>
    </Tooltip>
  )
}
