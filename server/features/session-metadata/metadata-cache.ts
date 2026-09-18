/**
 * Per-session metadata cache for snapshot assembly, with the freshness policy from
 * `server/features/session-metadata/README.md`. Values are content-free to this class;
 * callers own validation semantics through optional dependency strings.
 */

export interface MetadataCacheOptions {
  /** Entries older than this are reloaded even when generation and deps still match. */
  ttlMs: number
  /** Maximum distinct sessions retained; least-recently-used sessions are evicted. */
  maxSessions: number
  now?: () => number
}

interface MetadataEntry {
  value: unknown
  generation: number
  loadedAt: number
  deps?: string
}

export interface MetadataLoadResult<T> {
  value: T
  cached: boolean
}

/** Returns a stable cache dependency for either legacy or current Pi model state. */
export function modelDependency(model: unknown): string {
  if (typeof model === 'string') return model
  if (typeof model !== 'object' || model === null) return ''
  const { id, provider } = model as Record<string, unknown>
  return typeof id === 'string' && typeof provider === 'string' ? `${provider}/${id}` : ''
}

export class MetadataCache {
  readonly #ttlMs: number
  readonly #maxSessions: number
  readonly #now: () => number
  readonly #entries = new Map<string, MetadataEntry>()
  readonly #inflight = new Map<string, Promise<unknown>>()
  readonly #lastUsed = new Map<string, number>()
  readonly #prefixGenerations = new Map<string, number>()
  #epoch = 0

  constructor(options: Partial<MetadataCacheOptions> = {}) {
    this.#ttlMs = options.ttlMs ?? 60_000
    this.#maxSessions = options.maxSessions ?? 20
    this.#now = options.now ?? Date.now
  }

  /**
   * Loads a key. Serves the cached value while the generation, dependency string, and TTL
   * hold; combines concurrent loads into one `load` call. Failed loads are not cached.
   */
  async load<T>(
    key: string,
    load: () => Promise<T>,
    deps?: string,
  ): Promise<MetadataLoadResult<T>> {
    this.#touch(key)
    this.#evict()
    const entry = this.#entries.get(key)
    const generation = this.#generationFor(key)
    const fresh = entry !== undefined
      && entry.generation === generation
      && (deps === undefined || entry.deps === deps)
      && this.#now() - entry.loadedAt < this.#ttlMs
    if (entry && fresh) return { value: entry.value as T, cached: true }
    const inflight = this.#inflight.get(key) as Promise<T> | undefined
    if (inflight) return { value: await inflight, cached: true }
    const startedGeneration = generation
    const promise = (async () => {
      const value = await load()
      // An invalidation during the load must not repopulate the cache.
      if (this.#generationFor(key) === startedGeneration) {
        this.#entries.set(key, {
          value,
          generation: startedGeneration,
          loadedAt: this.#now(),
          deps,
        })
      }
      return value
    })()
    this.#inflight.set(key, promise as Promise<unknown>)
    try {
      return { value: await promise, cached: false }
    } finally {
      if (this.#inflight.get(key) === promise) this.#inflight.delete(key)
    }
  }

  /** Drops every entry whose key starts with the prefix and blocks in-flight repopulation. */
  invalidatePrefix(prefix: string): void {
    this.#prefixGenerations.set(prefix, (this.#prefixGenerations.get(prefix) ?? 0) + 1)
    for (const key of [...this.#entries.keys()]) {
      if (key.startsWith(prefix)) this.#entries.delete(key)
    }
  }

  /** Drops every entry for one session (exit or reassignment). */
  dropSession(sessionId: string): void {
    this.invalidatePrefix(`${sessionId}:`)
  }

  /** Manager disconnect/reconnect: everything is dropped; the next request reloads. */
  clear(): void {
    this.#epoch += 1
    this.#entries.clear()
    this.#inflight.clear()
  }

  #generationFor(key: string): number {
    let generation = this.#epoch
    for (const [prefix, value] of this.#prefixGenerations) {
      if (key.startsWith(prefix)) generation += value
    }
    return generation
  }

  #touch(key: string): void {
    this.#lastUsed.set(key, this.#now())
  }

  #evict(): void {
    const sessions = new Map<string, number>()
    for (const [key, usedAt] of this.#lastUsed) {
      const session = key.slice(key.indexOf(':') + 1)
      sessions.set(session, Math.max(sessions.get(session) ?? 0, usedAt))
    }
    while (sessions.size > this.#maxSessions) {
      let oldest: string | undefined
      for (const [session, usedAt] of sessions) {
        if (oldest === undefined || usedAt < (sessions.get(oldest) ?? 0)) oldest = session
      }
      if (oldest === undefined) break
      for (const key of [...this.#lastUsed.keys()]) {
        if (key.endsWith(`:${oldest}`)) {
          this.#entries.delete(key)
          this.#lastUsed.delete(key)
        }
      }
      sessions.delete(oldest)
    }
  }
}
