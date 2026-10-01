import type { RequestCause } from '../../api.ts'

/** Collects session lifecycle events for this long before refreshing the session list. */
export const sessionEventRefreshWindowMs = 250

export interface SessionRefreshBatcher {
  /** Requests one refresh; requests within the open window join it. */
  schedule(cause: RequestCause): void
  cancel(): void
}

/**
 * Coalesces event-driven session-list refreshes into one per window, attributed to the
 * event that opened it. A manager restart reopens every session and emits a burst of
 * `session_created` events; without batching, each event re-lists sessions and rescans the
 * session folder in every open tab.
 */
export function createSessionRefreshBatcher(
  refresh: (cause: RequestCause) => void,
  windowMs = sessionEventRefreshWindowMs,
): SessionRefreshBatcher {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    schedule(cause) {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        refresh(cause)
      }, windowMs)
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}
