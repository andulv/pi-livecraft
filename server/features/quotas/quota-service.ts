import { randomUUID } from 'node:crypto'
import type { ManagerEvent, QuotaResetStatus, QuotaSnapshot } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import type { ManagerClient } from '../../manager-client.ts'
import { QuotaCache } from './quota-cache.ts'

const resetOutcomeGracePeriodMs = 5_000

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
   * Redeems one banked reset through the extension command. Pi's RPC prompt
   * acknowledgement has no handler return value, so the extension emits a
   * correlated status event after its post-redemption refresh instead.
   */
  async reset(
    sessionId: string,
    target: 'openai' | 'glm-five-hour' | 'glm-week',
  ): Promise<{ ok: boolean; error?: string }> {
    const requestId = randomUUID()
    const outcome = this.#cache.waitForResetOutcome(requestId)
    const args = target === 'openai'
      ? ''
      : target === 'glm-week'
      ? 'glm week'
      : 'glm five-hour'
    const commandArgs = `${args ? `${args} ` : ''}--request-id=${requestId}`
    try {
      const response = await this.#manager.request({
        action: 'command',
        sessionId,
        command: { type: 'prompt', message: `/livecraft-quotas-reset ${commandArgs}` },
      }, 60_000)
      const legacyResult = resetResultFromText(
        isObject(response) && typeof response.data === 'string' ? response.data : undefined,
      )
      if (legacyResult) return legacyResult
      const status = await waitForResetStatus(outcome)
      return status
        ? resetResultFromStatus(status)
        : {
          ok: false,
          error: 'The reset result could not be confirmed. Refresh quotas before trying again.',
        }
    } finally {
      this.#cache.cancelResetOutcome(requestId)
    }
  }
}

/** Gives the event stream a moment to deliver the status emitted before Pi settled the prompt. */
function waitForResetStatus(
  outcome: Promise<QuotaResetStatus | undefined>,
): Promise<QuotaResetStatus | undefined> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), resetOutcomeGracePeriodMs)
    void outcome.then((status) => {
      clearTimeout(timeout)
      resolve(status)
    })
  })
}

function resetResultFromStatus(status: QuotaResetStatus): { ok: boolean; error?: string } {
  if (status.outcome === 'ok') return { ok: true }
  if (status.outcome === 'no_credit') return { ok: false, error: 'No banked reset is available.' }
  if (status.outcome === 'nothing_to_reset') {
    return {
      ok: false,
      error: 'Nothing to reset yet — the reset stays banked. Try again when a window is in use.',
    }
  }
  return { ok: false, error: status.error ?? 'Unable to redeem the banked reset.' }
}

/** Retains compatibility with older Pi runtimes that did expose a command string. */
function resetResultFromText(
  value: string | undefined,
): { ok: boolean; error?: string } | undefined {
  if (value === 'ok') return { ok: true }
  if (value === 'no_credit') return { ok: false, error: 'No banked reset is available.' }
  if (value === 'nothing_to_reset') {
    return {
      ok: false,
      error: 'Nothing to reset yet — the reset stays banked. Try again when a window is in use.',
    }
  }
  if (value?.startsWith('error: ')) return { ok: false, error: value.slice(7, 307) }
  return undefined
}
