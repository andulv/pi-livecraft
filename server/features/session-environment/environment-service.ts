import type { ManagerEvent, SessionEnvironmentSnapshot } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import type { ManagerClient } from '../../manager-client.ts'
import { EnvironmentCache } from './environment-cache.ts'

/** Coordinates per-session environment snapshots and refresh commands without exposing Pi details to HTTP routing. */
export class EnvironmentService {
  readonly #cache = new EnvironmentCache()
  readonly #manager: ManagerClient
  #refresh = new Map<string, Promise<SessionEnvironmentSnapshot>>()

  constructor(manager: ManagerClient) {
    this.#manager = manager
  }

  receiveManagerEvent(event: ManagerEvent): void {
    this.#cache.receiveManagerEvent(event)
  }

  /** Reports the session's cached environment and whether any Pi session exists. */
  async snapshot(sessionId: string): Promise<SessionEnvironmentSnapshot> {
    const sessions = await this.#manager.request({ action: 'list' })
    return this.#cache.snapshot(sessionId, !Array.isArray(sessions) || sessions.length === 0)
  }

  /** Deduplicates concurrent refreshes per session; the payload is assembled locally in Pi, so no throttle is needed. */
  refresh(sessionId: string): Promise<SessionEnvironmentSnapshot> {
    let refresh = this.#refresh.get(sessionId)
    if (!refresh) {
      refresh = (async () => {
        this.#cache.setRefreshing(sessionId, true)
        try {
          await this.#manager.request({
            action: 'command',
            sessionId,
            command: { type: 'prompt', message: '/livecraft-environment' },
          }, 60_000)
        } finally {
          this.#cache.setRefreshing(sessionId, false)
        }
        return this.#cache.snapshot(sessionId, false)
      })()
        .finally(() => {
          this.#refresh.delete(sessionId)
        })
      this.#refresh.set(sessionId, refresh)
    }
    return refresh
  }

  /** Warms the cache for one idle session after a backend restart without interrupting active sessions. */
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
