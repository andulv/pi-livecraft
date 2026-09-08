import { useEffect } from 'react'

import { postClientLog } from '../../api.ts'

/**
 * Registers window-level error capture and posts bounded, truncated entries to the
 * backend app log so frontend faults survive a page reload. Rendering itself is never
 * touched; reporting failures are silent.
 */
export function useClientErrorLog(): void {
  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      postClientLog('window-error', event.message)
    }
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason: unknown = event.reason
      postClientLog(
        'unhandled-rejection',
        reason instanceof Error ? reason.message : String(reason),
      )
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
}
