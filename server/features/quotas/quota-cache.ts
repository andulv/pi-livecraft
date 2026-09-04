import { isObject } from '../../../shared/is-object.ts'
import type {
  CopilotQuotaWindow,
  GlmQuotaReport,
  GlmQuotaResets,
  GlmQuotaSnapshot,
  GlmQuotaWindow,
  JsonObject,
  OpenAiQuotaReport,
  OpenAiQuotaResets,
  OpenAiQuotaSnapshot,
  OpenAiQuotaWindow,
  QuotaProviderReport,
  QuotaProviderSnapshot,
  QuotaReport,
  QuotaResetStatus,
  QuotaSnapshot,
} from '../../../shared/types.ts'

const emptyProvider = <T>(): QuotaProviderSnapshot<T> => ({ data: [], stale: false })
const quotaStatusKey = 'pi-livecraft.quotas'
const resetStatusKey = 'pi-livecraft.quota-reset'

interface ResetWaiter {
  resolve: (status: QuotaResetStatus | undefined) => void
}

/** Keeps each provider's last valid snapshot when the next one fails. */
export class QuotaCache {
  #openai: OpenAiQuotaSnapshot = emptyProvider<OpenAiQuotaWindow>()
  #copilot = emptyProvider<CopilotQuotaWindow>()
  #glm: GlmQuotaSnapshot = emptyProvider<GlmQuotaWindow>()
  #refreshing = false
  #resetWaiters = new Map<string, ResetWaiter>()

  snapshot(sessionRequired: boolean): QuotaSnapshot {
    return {
      openai: this.#openai,
      copilot: this.#copilot,
      glm: this.#glm,
      refreshing: this.#refreshing,
      sessionRequired,
    }
  }

  setRefreshing(refreshing: boolean): void {
    this.#refreshing = refreshing
  }

  /** Waits for the status event that carries one reset command's actual result. */
  waitForResetOutcome(requestId: string): Promise<QuotaResetStatus | undefined> {
    this.cancelResetOutcome(requestId)
    return new Promise((resolve) => {
      this.#resetWaiters.set(requestId, { resolve })
    })
  }

  /** Releases a waiter when the corresponding manager command fails before reporting an outcome. */
  cancelResetOutcome(requestId: string): void {
    this.#settleResetOutcome(requestId)
  }

  /** Accepts only the private, versioned statuses emitted by the quota extension. */
  receiveManagerEvent(event: unknown): boolean {
    const managerEvent = object(event)
    const data = object(managerEvent?.data)
    if (
      managerEvent?.event !== 'pi' || data?.type !== 'extension_ui_request'
      || data.method !== 'setStatus' || typeof data.statusText !== 'string'
    ) return false
    if (data.statusKey === resetStatusKey) return this.#receiveResetStatus(data.statusText)
    if (data.statusKey !== quotaStatusKey) return false
    let parsed: unknown
    try {
      parsed = JSON.parse(data.statusText)
    } catch {
      return false
    }
    const report = parseQuotaReport(parsed)
    if (!report) return false
    this.#openai = mergeOpenAi(this.#openai, report.openai, report.refreshedAt)
    this.#copilot = mergeProvider(this.#copilot, report.copilot, report.refreshedAt)
    if (report.glm) this.#glm = mergeGlm(this.#glm, report.glm, report.refreshedAt)
    this.#refreshing = false
    return true
  }

  #receiveResetStatus(statusText: string): boolean {
    let parsed: unknown
    try {
      parsed = JSON.parse(statusText)
    } catch {
      return false
    }
    const status = parseQuotaResetStatus(parsed)
    if (!status) return false
    this.#settleResetOutcome(status.requestId, status)
    return true
  }

  #settleResetOutcome(requestId: string, status?: QuotaResetStatus): void {
    const waiter = this.#resetWaiters.get(requestId)
    if (!waiter) return
    this.#resetWaiters.delete(requestId)
    waiter.resolve(status)
  }
}

/** Like `mergeProvider`, but a fresh report also replaces the banked resets. */
function mergeOpenAi(
  current: OpenAiQuotaSnapshot,
  report: OpenAiQuotaReport,
  updatedAt: number,
): OpenAiQuotaSnapshot {
  if (report.ok) {
    const base = { data: report.data, updatedAt, stale: false }
    return report.resets ? { ...base, resets: report.resets } : base
  }
  return { ...current, stale: current.updatedAt !== undefined, error: report.error }
}

/** Same retention rules for Z.AI reset cards. */
function mergeGlm(
  current: GlmQuotaSnapshot,
  report: GlmQuotaReport,
  updatedAt: number,
): GlmQuotaSnapshot {
  if (report.ok) {
    const base = { data: report.data, updatedAt, stale: false }
    return report.resets ? { ...base, resets: report.resets } : base
  }
  return { ...current, stale: current.updatedAt !== undefined, error: report.error }
}

function mergeProvider<T>(
  current: QuotaProviderSnapshot<T>,
  report: QuotaProviderReport<T>,
  updatedAt: number,
): QuotaProviderSnapshot<T> {
  if (report.ok) return { data: report.data, updatedAt, stale: false }
  return { ...current, stale: current.updatedAt !== undefined, error: report.error }
}

function parseQuotaReport(value: unknown): QuotaReport | undefined {
  const report = object(value)
  if (
    report?.protocol !== 'pi-livecraft.quotas' || report.version !== 1
    || !finiteNumber(report.refreshedAt)
  ) return undefined
  const openai = parseOpenAiReport(report.openai)
  const copilot = parseProvider(report.copilot, parseCopilotWindow)
  if (!openai || !copilot) return undefined
  const glm = parseGlmReport(report.glm)
  return {
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: report.refreshedAt,
    openai,
    copilot,
    ...(glm ? { glm } : {}),
  }
}

function parseQuotaResetStatus(value: unknown): QuotaResetStatus | undefined {
  const status = object(value)
  if (
    status?.protocol !== 'pi-livecraft.quota-reset' || status.version !== 1
    || !validRequestId(status.requestId)
  ) return undefined
  const outcome = status.outcome
  if (
    outcome !== 'ok' && outcome !== 'no_credit' && outcome !== 'nothing_to_reset'
    && outcome !== 'error'
  ) return undefined
  const error = typeof status.error === 'string' && status.error.trim()
    ? status.error.trim().slice(0, 300)
    : undefined
  return {
    protocol: 'pi-livecraft.quota-reset',
    version: 1,
    requestId: status.requestId,
    outcome,
    ...(error ? { error } : {}),
  }
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
}

function parseProvider<T>(
  value: unknown,
  parseItem: (value: unknown) => T | undefined,
): QuotaProviderReport<T> | undefined {
  const provider = object(value)
  if (provider?.ok === false && typeof provider.error === 'string')
    return {
      ok: false,
      error: provider.error.slice(0, 300),
    }
  if (provider?.ok !== true || !Array.isArray(provider.data)) return undefined
  const data = provider.data.map(parseItem)
  return data.every((item): item is T => item !== undefined) ? { ok: true, data } : undefined
}

function parseOpenAiReport(value: unknown): OpenAiQuotaReport | undefined {
  const provider = parseProvider(value, parseOpenAiWindow)
  if (!provider || provider.ok === false) return provider
  const resets = parseResets(object(value)?.resets)
  return resets ? { ...provider, resets } : provider
}

function parseGlmReport(value: unknown): GlmQuotaReport | undefined {
  const provider = parseProvider(value, parseGlmWindow)
  if (!provider || provider.ok === false) return provider
  const resets = parseGlmResets(object(value)?.resets)
  return resets ? { ...provider, resets } : provider
}

/** Parses the nested Z.AI reset-card summary already normalized by the extension. */
function parseGlmResets(value: unknown): GlmQuotaResets | undefined {
  const resets = object(value)
  const fiveHour = resets && parseResetSummary(resets.fiveHour)
  const week = resets && parseResetSummary(resets.week)
  if (fiveHour === undefined && week === undefined) return undefined
  return {
    fiveHour: fiveHour ?? { availableCount: 0 },
    week: week ?? { availableCount: 0 },
  }
}

function parseResetSummary(
  value: unknown,
): { availableCount: number; nearestExpiry?: number } | undefined {
  const summary = object(value)
  if (summary === undefined || !finiteNumber(summary.availableCount)) return undefined
  const count = Math.max(0, Math.round(summary.availableCount))
  const nearestExpiry = finiteNumber(summary.nearestExpiry) ? summary.nearestExpiry : undefined
  return { availableCount: count, ...(nearestExpiry ? { nearestExpiry } : {}) }
}

function parseResets(value: unknown): OpenAiQuotaResets | undefined {
  const resets = object(value)
  if (resets === undefined || !finiteNumber(resets.availableCount)) return undefined
  const count = Math.max(0, Math.round(resets.availableCount))
  const nearestExpiry = finiteNumber(resets.nearestExpiry) ? resets.nearestExpiry : undefined
  return { availableCount: count, ...(nearestExpiry ? { nearestExpiry } : {}) }
}

function parseOpenAiWindow(value: unknown): OpenAiQuotaWindow | undefined {
  const window = object(value)
  if (
    (window?.period !== '5h' && window?.period !== '7d') || !finiteNumber(window.remainingPercent)
  ) return undefined
  const resetsAt = finiteNumber(window.resetsAt) ? window.resetsAt : undefined
  return {
    period: window.period,
    remainingPercent: Math.min(100, Math.max(0, window.remainingPercent)),
    ...(resetsAt ? { resetsAt } : {}),
  }
}

function parseCopilotWindow(value: unknown): CopilotQuotaWindow | undefined {
  const window = object(value)
  if (
    typeof window?.name !== 'string' || !finiteNumber(window.used) || !finiteNumber(window.limit)
    || window.limit <= 0
  ) return undefined
  const resetsAt = finiteNumber(window.resetsAt) ? window.resetsAt : undefined
  return {
    name: window.name.slice(0, 80),
    used: Math.max(0, window.used),
    limit: window.limit,
    ...(resetsAt ? { resetsAt } : {}),
  }
}

function parseGlmWindow(value: unknown): GlmQuotaWindow | undefined {
  const window = object(value)
  if (!window || typeof window.kind !== 'string') return undefined
  if (window.kind !== 'session' && window.kind !== 'weekly' && window.kind !== 'web-searches') {
    return undefined
  }
  const resetsAt = finiteNumber(window.resetsAt) ? window.resetsAt : undefined
  if (window.kind === 'web-searches') {
    if (!finiteNumber(window.used) || !finiteNumber(window.limit) || window.limit <= 0) {
      return undefined
    }
    return {
      kind: 'web-searches',
      used: Math.max(0, window.used),
      limit: window.limit,
      ...(resetsAt ? { resetsAt } : {}),
    }
  }
  if (!finiteNumber(window.usedPercent)) return undefined
  return {
    kind: window.kind,
    usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
    ...(resetsAt ? { resetsAt } : {}),
  }
}

function object(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
