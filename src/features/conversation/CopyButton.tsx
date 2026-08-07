import { useEffect, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'

interface CopyButtonProps {
  direction?: 'input' | 'output'
  label: string
  onError?: (cause: unknown) => void
  value: string | (() => string)
}

/** Copies a conversation value and reports a short success state through its tooltip. */
export function CopyButton({ direction, label, onError, value }: CopyButtonProps) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timeout)
  }, [copied])

  /** Copies the supplied value without changing the surrounding conversation state. */
  async function copyValue(): Promise<void> {
    setBusy(true)
    try {
      const text = typeof value === 'function' ? value() : value
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch (cause) {
      onError?.(cause)
    } finally {
      setBusy(false)
    }
  }

  const accessibleLabel = copied ? 'Copied' : label
  return (
    <Tooltip label={accessibleLabel}>
      <button
        aria-label={accessibleLabel}
        className='conversation-action-button'
        disabled={busy}
        onClick={() => void copyValue()}
        type='button'
      >
        <svg aria-hidden='true' viewBox='0 0 16 16'>
          <rect fill='none' height='9' rx='1.5' stroke='currentColor' width='8' x='5.5' y='4.5' />
          <path
            d='M3.5 11.5h-1A1.5 1.5 0 0 1 1 10V2.5A1.5 1.5 0 0 1 2.5 1h7A1.5 1.5 0 0 1 11 2.5v1'
            fill='none'
            stroke='currentColor'
          />
          {direction && (
            <path
              d={direction === 'input'
                ? 'M8.5 9.5 11 12m0 0v-2m0 2H9'
                : 'M8.5 11.5 11 9m0 0v2m0-2H9'}
              fill='none'
              stroke='currentColor'
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth='1.25'
            />
          )}
        </svg>
      </button>
    </Tooltip>
  )
}
