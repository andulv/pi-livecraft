import { useState } from 'react'
import { openWorkspaceFile } from '../../api.ts'
import { Tooltip } from '../../components/Tooltip.tsx'

interface OpenFileButtonProps {
  cwd: string
  onError: (cause: unknown) => void
  path: string
}

/** Opens a tool call's file with the operating system's default application. */
export function OpenFileButton({ cwd, onError, path }: OpenFileButtonProps) {
  const [busy, setBusy] = useState(false)

  async function openFile(): Promise<void> {
    setBusy(true)
    try {
      await openWorkspaceFile(cwd, path)
    } catch (cause) {
      onError(cause)
    } finally {
      setBusy(false)
    }
  }

  const label = busy ? 'Opening file…' : 'Open file'
  return (
    <Tooltip label={label}>
      <button
        aria-label={label}
        className='conversation-action-button open-file-action'
        disabled={busy}
        onClick={() => void openFile()}
        type='button'
      >
        <svg aria-hidden='true' viewBox='0 0 16 16'>
          <path
            d='M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3'
            fill='none'
            stroke='currentColor'
          />
          <path
            d='M9 2.5h4.5V7m0-4.5-7 7'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      </button>
    </Tooltip>
  )
}
