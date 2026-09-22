import type { ManagerEvent, QuotaSnapshot } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import type { ManagerClient } from '../../manager-client.ts'
import { QuotaCache } from './quota-cache.ts'

const resetRefreshGracePeriodMs = 5_000

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
   * Redeems one provider reset, then verifies it from the normal quota report the
   * extension already publishes after every redemption.
   */
  async reset(
    sessionId: string,
    target: 'anthropic' | 'openai' | 'glm-five-hour' | 'glm-week',
  ): Promise<{ ok: boolean; error?: string }> {
    const before = resetState(this.#cache.snapshot(false), target)
    const report = this.#cache.waitForNextReport()
    const args = target === 'openai'
      ? ''
      : target === 'anthropic'
      ? 'anthropic'
      : target === 'glm-week'
      ? 'glm week'
      : 'glm five-hour'
    try {
      await this.#manager.request({
        action: 'command',
        sessionId,
        command: { type: 'prompt', message: `/livecraft-quotas-reset${args ? ` ${args}` : ''}` },
      }, 60_000)
      await waitForQuotaReport(report.promise)
      const after = resetState(this.#cache.snapshot(false), target)
      if (resetChanged(target, before, after)) return { ok: true }
      return {
        ok: false,
        error: 'The reset result could not be confirmed from the refreshed quota data.',
      }
    } finally {
      report.cancel()
    }
  }
}

interface AnthropicResetState {
  grantId?: string
  resetsLeft: number
}

type ResetState = AnthropicResetState | number

function resetState(
  snapshot: QuotaSnapshot,
  target: 'anthropic' | 'openai' | 'glm-five-hour' | 'glm-week',
): ResetState | undefined {
  if (target === 'anthropic') {
    const reset = snapshot.anthropic.resets
    return reset ? { grantId: reset.grantId, resetsLeft: reset.resetsLeft } : undefined
  }
  if (target === 'openai') return snapshot.openai.resets?.availableCount
  return target === 'glm-five-hour'
    ? snapshot.glm.resets?.fiveHour.availableCount
    : snapshot.glm.resets?.week.availableCount
}

function resetChanged(
  target: 'anthropic' | 'openai' | 'glm-five-hour' | 'glm-week',
  before: ResetState | undefined,
  after: ResetState | undefined,
): boolean {
  if (before === undefined || after === undefined) return false
  if (target === 'anthropic') {
    if (typeof before === 'number' || typeof after === 'number') return false
    return after.resetsLeft < before.resetsLeft || after.grantId !== before.grantId
  }
  return typeof before === 'number' && typeof after === 'number' && after < before
}

/** Avoids hanging the reset button if Pi fails to publish its normal report. */
function waitForQuotaReport(report: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, resetRefreshGracePeriodMs)
    void report.then(() => {
      clearTimeout(timeout)
      resolve()
    })
  })
}
