/**
 * Defers automatic snapshots while hidden. Selection loads and explicit refreshes
 * bypass the gate; returning to a selected session always reconciles missed events.
 */
export class SnapshotGate {
  #hidden: boolean

  constructor(initiallyHidden: boolean) {
    this.#hidden = initiallyHidden
  }

  /** An automatic refresh request: run it now when visible, otherwise defer it. */
  schedule(): 'run' | 'deferred' {
    return this.#hidden ? 'deferred' : 'run'
  }

  /** A finished fetch still needs a follow-up: while hidden, stop the loop instead. */
  followUp(needsFollowUp: boolean): boolean {
    return this.#hidden && needsFollowUp
  }

  /** Reconcile the selected session on return even if its completion events were missed. */
  visibilityChanged(hidden: boolean, selectedId: string): 'run' | undefined {
    const wasHidden = this.#hidden
    this.#hidden = hidden
    if (wasHidden && !hidden && selectedId) return 'run'
    return undefined
  }
}
