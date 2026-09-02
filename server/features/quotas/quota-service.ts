import type { ManagerEvent, QuotaSnapshot } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import type { ManagerClient } from '../../manager-client.ts'
import { QuotaCache } from './quota-cache.ts'

/** Coordinates quota snapshots and refresh commands without exposing Pi details to HTTP routing. */
export class QuotaService {
  readonly #cache = new QuotaCache()
  readonly #manager: ManagerClient
  #refresh: Promise<QuotaSnapshot> | undefined

  constructor(manager: ManagerClient) {
    this.#manager = manager
  }

  receiveManagerEvent(event: ManagerEvent): void {
    this.#cache.receiveManagerEvent(event)
  }

  /** Reports cached quotas and whether a Pi session is required to refresh them. */
  async snapshot(): Promise<QuotaSnapshot> {
    const sessions = await this.#manager.request({ action: 'list' })
    return this.#cache.snapshot(!Array.isArray(sessions) || sessions.length === 0)
  }

  /** Deduplicates concurrent requests and lets the extension apply its automatic delay. */
  refresh(sessionId: string, automatic = false): Promise<QuotaSnapshot> {
    this.#refresh ??= (async () => {
      this.#cache.setRefreshing(true)
      try {
        await this.#manager.request({
          action: 'command',
          sessionId,
          command: { type: 'prompt', message: `/livecraft-quotas${automatic ? ' auto' : ''}` },
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
        await this.refresh(idleSession.id, true)
    } catch {
      // A manual refresh remains possible once the manager is available.
    }
  }

  /**
   * Redeems one banked reset through the extension command. The command
   * refreshes the published report itself, so the manager response carries only
   * the redemption outcome string defined by the extension.
   */
  async reset(
    sessionId: string,
    target: 'openai' | 'glm-five-hour' | 'glm-week',
  ): Promise<{ ok: boolean; error?: string }> {
    const args = target === 'openai'
      ? ''
      : target === 'glm-week'
      ? 'glm week'
      : 'glm five-hour'
    const response = await this.#manager.request({
      action: 'command',
      sessionId,
      command: { type: 'prompt', message: `/livecraft-quotas-reset${args ? ` ${args}` : ''}` },
    }, 60_000)
    const result = isObject(response) && typeof response.data === 'string'
      ? response.data
      : undefined
    if (result === 'ok') return { ok: true }
    if (result === 'no_credit') return { ok: false, error: 'No banked reset is available.' }
    if (result === 'nothing_to_reset') {
      return {
        ok: false,
        error: 'Nothing to reset yet — the reset stays banked. Try again when a window is in use.',
      }
    }
    if (result?.startsWith('error: ')) return { ok: false, error: result.slice(7, 307) }
    return { ok: false, error: 'The reset command returned an unexpected response.' }
  }
}
