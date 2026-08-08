import type { CopilotQuotaWindow, GlmQuotaWindow, OpenAiQuotaWindow } from './types.ts'
import { isObject } from './is-object.ts'

/** Extracts rate-limit windows from OpenAI's opaque quota response. */
export function parseOpenAiUsage(value: unknown): OpenAiQuotaWindow[] {
  const root = object(value)
  const rateLimit = object(root?.rate_limit) ?? object(root?.rate_limits)
  if (!rateLimit) return []
  const candidates = [
    object(rateLimit.primary_window) ?? object(rateLimit.primary) ?? object(
      rateLimit.five_hour_limit,
    ) ?? object(rateLimit.five_hour),
    object(rateLimit.secondary_window) ?? object(rateLimit.secondary) ?? object(
      rateLimit.weekly_limit,
    ) ?? object(rateLimit.weekly),
  ]
  return candidates
    .flatMap((window, index): OpenAiQuotaWindow[] => {
      if (!window) return []
      const seconds = numberField(window, 'limit_window_seconds')
      const period: OpenAiQuotaWindow['period'] = seconds && seconds >= 6 * 24 * 60 * 60
        ? '7d'
        : index === 0
        ? '5h'
        : '7d'
      const used = numberField(window, 'used_percent') ?? percentUsedFromRemaining(window)
      if (used === undefined) return []
      const resetsAt = dateValue(window.reset_at ?? window.reset_time_ms)
      return [{ period, remainingPercent: clamp(100 - used), ...(resetsAt ? { resetsAt } : {}) }]
    })
    .filter((window, index, windows) =>
      windows.findIndex(({ period }) => period === window.period) === index
    )
}

/** Extracts monthly quota buckets from GitHub Copilot's opaque quota response. */
export function parseCopilotUsage(value: unknown): CopilotQuotaWindow[] {
  const root = object(value)
  const snapshots = object(root?.quota_snapshots)
  const resetsAt = dateValue(
    root?.quota_reset_date ?? root?.quota_reset_date_utc ?? root?.limited_user_reset_date,
  )
  if (snapshots) {
    const labels: [string, string][] = [['premium_interactions', 'Premium interactions'], [
      'chat',
      'Chat',
    ], ['completions', 'Completions']]
    return labels.flatMap(([key, name]) => {
      const quota = object(snapshots[key])
      if (!quota || quota.unlimited === true) return []
      const limit = numberField(quota, 'entitlement')
      const remaining = numberField(quota, 'remaining') ?? numberField(quota, 'quota_remaining')
      return limit && remaining !== undefined
        ? [{ name, used: Math.max(0, limit - remaining), limit, ...(resetsAt ? { resetsAt } : {}) }]
        : []
    })
  }
  const limits = object(root?.monthly_quotas)
  const remaining = object(root?.limited_user_quotas)
  if (!limits || !remaining) return []
  return ([['chat', 'Chat'], ['completions', 'Completions']] as const).flatMap(([key, name]) => {
    const limit = numberField(limits, key)
    const left = numberField(remaining, key)
    return limit && left !== undefined
      ? [{ name, used: Math.max(0, limit - left), limit, ...(resetsAt ? { resetsAt } : {}) }]
      : []
  })
}

/** Extracts Coding Plan quota windows from Z.AI's `usage/quota/limit` response. */
export function parseGlmUsage(value: unknown): GlmQuotaWindow[] {
  const limits = extractGlmLimits(object(value))
  if (!Array.isArray(limits) || limits.length === 0) return []
  const windows: GlmQuotaWindow[] = []

  const session = findGlmLimit(limits, 'TOKENS_LIMIT', 3)
  const sessionPercent = numberField(session, 'percentage')
  if (session && sessionPercent !== undefined) {
    const resetsAt = dateValue(object(session)?.nextResetTime)
    windows.push({
      kind: 'session',
      usedPercent: sessionPercent,
      ...(resetsAt ? { resetsAt } : {}),
    })
  }

  const weekly = findGlmLimit(limits, 'TOKENS_LIMIT', 6)
  const weeklyPercent = numberField(weekly, 'percentage')
  if (weekly && weeklyPercent !== undefined) {
    const resetsAt = dateValue(object(weekly)?.nextResetTime)
    windows.push({ kind: 'weekly', usedPercent: weeklyPercent, ...(resetsAt ? { resetsAt } : {}) })
  }

  const searches = findGlmLimit(limits, 'TIME_LIMIT')
  const used = numberField(searches, 'currentValue')
  const limit = numberField(searches, 'usage')
  if (searches && used !== undefined && limit !== undefined && limit > 0) {
    // Monthly web-search windows omit a reset time when the limit rolls over at UTC month start.
    const resetsAt = dateValue(object(searches)?.nextResetTime) ?? nextUtcFirstOfMonthMs()
    windows.push({ kind: 'web-searches', used, limit, ...(resetsAt ? { resetsAt } : {}) })
  }

  return windows
}

/** Accepts both `{ data: { limits: [] } }` and a top-level `limits`/array shape. */
function extractGlmLimits(root: Record<string, unknown> | undefined): unknown {
  const container = root?.data ?? root
  if (Array.isArray(container)) return container
  return object(container)?.limits
}

/**
 * Matches a limit by `type || name`, then by `unit` when supplied. The first matching entry
 * whose `unit` is undefined is the fallback, mirroring Z.AI's Coding Plan limit layout where
 * the session (unit 3) and weekly (unit 6) windows share the `TOKENS_LIMIT` type.
 */
function findGlmLimit(
  limits: unknown[],
  type: string,
  unit?: number,
): Record<string, unknown> | undefined {
  let fallback: Record<string, unknown> | undefined
  for (const entry of limits) {
    const item = object(entry)
    if (!item) continue
    if (item.type === type || item.name === type) {
      if (unit === undefined) return item
      if (item.unit === unit) return item
      if (fallback === undefined && item.unit === undefined) fallback = item
    }
  }
  return fallback
}

function nextUtcFirstOfMonthMs(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
}

/**
 * Returns a message when Z.AI's response envelope reports a business failure (HTTP 200 with an
 * error code/success:false/error), otherwise undefined. Z.AI signals auth, rate-limit, and
 * permission failures this way rather than via the HTTP status, so they must be surfaced
 * explicitly instead of degrading to empty data.
 */
export function glmBusinessError(value: unknown): string | undefined {
  const root = object(value)
  if (!root) return undefined
  const code = root.code
  const failedByCode = code !== undefined && String(code) !== '200'
  const failedBySuccess = root.success === false
  const failedByError = root.error !== undefined && root.error !== null
  if (!failedByCode && !failedBySuccess && !failedByError) return undefined
  const detail = glmBusinessMessage(root) ?? (failedByCode ? `code ${code}` : undefined)
  return `Z.AI rejected the quota request${detail ? `: ${detail}` : ''}.`
}

function glmBusinessMessage(root: Record<string, unknown>): string | undefined {
  const raw = readString(object(root.error)?.message)
    ?? readString(root.msg)
    ?? readString(root.message)
    ?? (typeof root.error === 'string' && root.error ? root.error : undefined)
  return raw ? raw.slice(0, 180) : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function percentUsedFromRemaining(value: Record<string, unknown>): number | undefined {
  const remaining = numberField(value, 'percent_left') ?? numberField(value, 'remaining_percent')
  return remaining === undefined ? undefined : 100 - remaining
}

function dateValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return value < 10_000_000_000
      ? value * 1000
      : value
  if (typeof value !== 'string' || !value) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function object(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  const raw = object(value)?.[key]
  if (raw === null || raw === '' || raw === undefined) return undefined
  const field = Number(raw)
  return Number.isFinite(field) ? field : undefined
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value))
}
