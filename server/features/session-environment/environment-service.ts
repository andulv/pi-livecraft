import type { ManagerEvent, SessionEnvironmentSnapshot } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import type { ManagerClient } from '../../manager-client.ts'
import { EnvironmentCache } from './environment-cache.ts'

/** Coordinates environment snapshots and refresh commands without exposing Pi details to HTTP routing. */
export class EnvironmentService {
  readonly #cache = new EnvironmentCache()
  readonly #manager: ManagerClient
  #refresh: Promise<SessionEnvironmentSnapshot> | undefined

  constructor(manager: ManagerClient) {
    this.#manager = manager
  }

  receiveManagerEvent(event: ManagerEvent): void {
    this.#cache.receiveManagerEvent(event)
  }

  /** Reports the cached environment and whether a Pi session is required to refresh it. */
  async snapshot(): Promise<SessionEnvironmentSnapshot> {
    const sessions = await this.#manager.request({ action: 'list' })
    return this.#cache.snapshot(!Array.isArray(sessions) || sessions.length === 0)
  }

  /** Deduplicates concurrent refreshes; the payload is assembled locally in Pi, so no throttle is needed. */
  refresh(sessionId: string): Promise<SessionEnvironmentSnapshot> {
    this.#refresh ??= (async () => {
      this.#cache.setRefreshing(true)
      try {
        await this.#manager.request({
          action: 'command',
          sessionId,
          command: { type: 'prompt', message: '/livecraft-environment' },
        }, 60_000)
      } finally {
        this.#cache.setRefreshing(false)
      }
      return this.#cache.snapshot(false)
    })()
      .finally(() => {
        this.#refresh = undefined
      })
    return this.#refresh
  }

  /** Restores the cache after a backend restart without interrupting an active session. */
  async restoreFromIdleSession(): Promise<void> {
    try {
      const sessions = await this.#manager.request({ action: 'list' })
      if (!Array.isArray(sessions)) return
      const idleSession = sessions.find((session) =>
        isObject(session) && session.status === 'idle' && typeof session.id === 'string'
      )
      if (isObject(idleSession) && typeof idleSession.id === 'string')
        await this.refresh(idleSession.id)
    } catch {
      // A manual refresh remains possible once the manager is available.
    }
  }
}
