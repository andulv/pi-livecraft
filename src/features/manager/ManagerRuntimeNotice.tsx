import { useEffect, useState } from 'react'
import type { ManagerRuntimeStatus } from '../../../shared/types.ts'
import './manager.css'

interface ManagerRuntimeNoticeProps {
  activeSession: boolean
  status: ManagerRuntimeStatus
  onRestart: () => Promise<void>
  onError: (cause: unknown) => void
}

/** Keeps an obsolete manager visible until a verified replacement reconnects. */
export function ManagerRuntimeNotice({ activeSession, status, onRestart, onError }: ManagerRuntimeNoticeProps) {
  const [requesting, setRequesting] = useState(false)
  useEffect(() => {
    if (status.state !== 'stale') setRequesting(false)
  }, [status.state])

  const restartFailed = status.state === 'disconnected' && Boolean(status.error)
  if (status.state === 'current' || status.state === 'checking' || (status.state === 'disconnected' && !restartFailed)) return null

  const restarting = status.state === 'restarting' || requesting
  const unknown = status.state === 'unknown' || restartFailed
  const disabled = restarting || activeSession || !status.canRestart

  /** Keeps the action disabled through the HTTP acknowledgement and reports request errors. */
  async function restart(): Promise<void> {
    setRequesting(true)
    try {
      await onRestart()
    } catch (cause) {
      setRequesting(false)
      onError(cause)
    }
  }

  return <aside aria-live="polite" className={`manager-runtime-notice ${unknown ? 'unknown' : ''}`}>
    <div>
      <strong>{restartFailed ? 'Manager restart failed' : unknown ? 'Manager version unavailable' : restarting ? 'Restarting the manager…' : 'Manager update available'}</strong>
      <p>{unknown
        ? status.error ?? 'The running manager version could not be verified.'
        : activeSession
          ? 'Wait for active Pi sessions to finish before restarting.'
          : status.canRestart
            ? 'The running code no longer matches its runtime files. Idle sessions will close and can be reopened from history.'
            : 'Restart Pi Livecraft to load the updated manager code.'}</p>
    </div>
    {!unknown && (status.canRestart || restarting) && <button aria-busy={restarting} disabled={disabled} onClick={() => void restart()} type="button">
      {restarting ? 'Restarting…' : 'Restart manager'}
    </button>}
  </aside>
}
