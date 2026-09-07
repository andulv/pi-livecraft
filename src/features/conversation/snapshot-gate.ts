/**
 * Decides when the conversation scheduler may start automatic snapshots and defers
 * them while the page is hidden. Selection loads and explicit refreshes bypass the gate.
 */
export class SnapshotGate {
  #hidden: boolean
  #deferredSession = ''

  constructor(initiallyHidden: boolean) {
    this.#hidden = initiallyHidden
  }

  /** An automatic refresh request: run it now when visible, otherwise defer it. */
  schedule(sessionId: string): 'run' | 'deferred' {
    if (!this.#hidden) return 'run'
    this.#deferredSession = sessionId
    return 'deferred'
  }

  /** A finished fetch still needs a follow-up: while hidden, stop the loop and defer instead. */
  followUp(sessionId: string, needsFollowUp: boolean): boolean {
    if (!this.#hidden || !needsFollowUp) return false
    this.#deferredSession = sessionId
    return true
  }

  /**
   * Visibility changed. Returning to a visible page with deferred work for the selected
   * session reports one catch-up run; deferred work for any other session is dropped.
   */
  visibilityChanged(hidden: boolean, selectedId: string): 'run' | undefined {
    this.#hidden = hidden
    const deferred = this.#deferredSession
    this.#deferredSession = ''
    if (!hidden && deferred && deferred === selectedId) return 'run'
    return undefined
  }

  /** A selection change invalidates any deferred session. */
  selectionChanged(): void {
    this.#deferredSession = ''
  }
}
