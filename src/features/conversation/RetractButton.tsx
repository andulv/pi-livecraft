import { useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'

/** Removes one steering message from Pi's pending queue. */
export function RetractButton({ onError, onRetract }: {
  onError: (cause: unknown) => void
  onRetract: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  async function retract(): Promise<void> {
    setBusy(true)
    try {
      await onRetract()
    } catch (cause) {
      onError(cause)
    } finally {
      setBusy(false)
    }
  }

  const label = busy ? 'Retracting steering message' : 'Retract steering message'
  return (
    <Tooltip label={label}>
      <button
        aria-label={label}
        className='conversation-action-button retract-steering-action'
        disabled={busy}
        onClick={() => void retract()}
        type='button'
      >
        <svg aria-hidden='true' fill='none' stroke='currentColor' viewBox='0 0 16 16'>
          <path
            d='M3 5.5h10M6 5.5V3.5h4v2M5 7.5v5h6v-5M7 9.5v1.5M9 9.5v1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      </button>
    </Tooltip>
  )
}
