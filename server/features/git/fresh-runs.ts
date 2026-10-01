interface KeyState<T> {
  running: Promise<T> | undefined
  queued: Promise<T> | undefined
}

/**
 * Coalesces repeated reads per key without serving results older than the request: callers
 * that arrive together share one run, and a caller arriving while a run is in progress shares
 * the single run queued behind it. Every result therefore comes from a run that started after
 * the caller asked, while at most one run per key executes and one waits.
 */
export class FreshRuns<T> {
  readonly #gatherMs: number
  readonly #states = new Map<string, KeyState<T>>()

  /** `gatherMs` delays an idle key's run so near-simultaneous callers (other tabs) join it. */
  constructor(gatherMs = 0) {
    this.#gatherMs = gatherMs
  }

  run(key: string, task: () => Promise<T>): Promise<T> {
    let state = this.#states.get(key)
    if (!state) {
      state = { running: undefined, queued: undefined }
      this.#states.set(key, state)
    }
    if (state.queued) return state.queued
    const current = state
    const previous = current.running
    const queued = (async (): Promise<T> => {
      // Always yields before starting, so `queued` is registered before it is cleared and
      // callers in the same tick join this run.
      await (previous
        ? previous.catch(() => undefined)
        : new Promise((resolve) => setTimeout(resolve, this.#gatherMs)))
      // From here on, new callers queue a later run: this one may miss their changes.
      current.queued = undefined
      const running = Promise.resolve().then(task)
      current.running = running
      try {
        return await running
      } finally {
        if (current.running === running) {
          current.running = undefined
          if (!current.queued) this.#states.delete(key)
        }
      }
    })()
    current.queued = queued
    return queued
  }
}
