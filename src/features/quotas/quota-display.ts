import type { QuotaSnapshot } from '../../../shared/types.ts'

export type QuotaProvider = 'openai' | 'copilot' | 'glm'

export interface RailQuota {
  label: string
  secondaryValue?: string
  stale: boolean
  value: string
}

export type QuotaUsagePace = 'on-track' | 'caution' | 'high'

/** Cumulative-usage limits that separate the green, yellow, and red bar segments. */
export interface QuotaUsagePaceBands {
  cautionLimit: number
  onTrackLimit: number
}

const periodDuration: Record<'5h' | '7d' | 'session' | 'weekly', number> = {
  '5h': 5 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  session: 5 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
}

/** Returns how much of a known reset window has elapsed, when its reset is known. */
export function quotaPeriodProgress(
  kind: '5h' | '7d' | 'session' | 'weekly' | 'web-searches',
  resetsAt: number | undefined,
  now: number,
): number | undefined {
  if (kind === 'web-searches' || !resetsAt) return undefined
  const duration = periodDuration[kind]
  return Math.max(0, Math.min(100, (1 - (resetsAt - now) / duration) * 100))
}

/** Returns elapsed progress through Copilot's calendar-month quota period. */
export function copilotPeriodProgress(
  resetsAt: number | undefined,
  now: number,
): number | undefined {
  if (!resetsAt) return undefined
  const reset = new Date(resetsAt)
  const startsAt = Date.UTC(reset.getUTCFullYear(), reset.getUTCMonth() - 1, 1)
  const duration = resetsAt - startsAt
  if (!Number.isFinite(duration) || duration <= 0) return undefined
  return Math.max(0, Math.min(100, (now - startsAt) / duration * 100))
}

const dayMs = 24 * 60 * 60 * 1000
const glmPeakUtcStartHour = 6
const glmPeakUtcHours = 4

/** One peak-priced span of the local day, as fractions from 0 to 1. */
export interface GlmPeakSegment {
  end: number
  start: number
}

export interface GlmPeakDay {
  /** UTC timestamp of local midnight starting the displayed day. */
  dayStart: number
  /** Current time as a fraction of the local day (0 to 1). */
  nowFraction: number
  peakSegments: GlmPeakSegment[]
}

/**
 * Lays out Z.AI's peak-pricing window (14:00-18:00 UTC+8, i.e. 06:00-10:00 UTC)
 * across the local day. `localOffsetMinutes` is minutes east of UTC (the
 * negated `Date#getTimezoneOffset`), so segments wrap local midnight correctly.
 */
export function glmPeakDay(now: number, localOffsetMinutes: number): GlmPeakDay {
  const offsetMs = localOffsetMinutes * 60_000
  const localDayStart = now - (now + offsetMs) % dayMs
  const utcDay = Math.floor(localDayStart / dayMs) * dayMs
  const peakSegments: GlmPeakSegment[] = []
  for (const dayShift of [-1, 0, 1]) {
    const peakStart = utcDay + dayShift * dayMs + glmPeakUtcStartHour * 3_600_000
    const peakEnd = peakStart + glmPeakUtcHours * 3_600_000
    const from = Math.max(peakStart, localDayStart)
    const to = Math.min(peakEnd, localDayStart + dayMs)
    if (to > from) {
      peakSegments.push({
        start: (from - localDayStart) / dayMs,
        end: (to - localDayStart) / dayMs,
      })
    }
  }
  return { dayStart: localDayStart, nowFraction: (now - localDayStart) / dayMs, peakSegments }
}

/**
 * Returns pace bands for cumulative usage. The first 10% of a window has wider
 * limits because setup work often causes a short, non-representative usage burst.
 */
export function quotaUsagePaceBands(periodPercent: number): QuotaUsagePaceBands {
  const period = Math.max(0, Math.min(100, periodPercent))
  return period < 10
    ? { onTrackLimit: 15 - period, cautionLimit: 40 - period * 2 }
    : { onTrackLimit: period - 5, cautionLimit: period + 10 }
}

export function quotaUsagePace(usedPercent: number, periodPercent: number): QuotaUsagePace {
  const used = Math.max(0, Math.min(100, usedPercent))
  const { cautionLimit, onTrackLimit } = quotaUsagePaceBands(periodPercent)
  if (used <= onTrackLimit) return 'on-track'
  return used <= cautionLimit ? 'caution' : 'high'
}

export function quotaProviderForModel(provider: unknown): QuotaProvider | undefined {
  if (provider === 'openai-codex') return 'openai'
  if (provider === 'github-copilot') return 'copilot'
  if (provider === 'zai') return 'glm'
  return undefined
}

/** Summarizes the main window of the active provider for the compact rail. */
export function railQuota(
  quotas: QuotaSnapshot | null,
  provider: QuotaProvider | undefined,
): RailQuota | undefined {
  if (!quotas || !provider) return undefined
  if (provider === 'openai') {
    const window = quotas.openai.data.find(({ period }) => period === '5h') ?? quotas.openai.data[0]
    if (!window) return undefined
    const usedPercent = 100 - window.remainingPercent
    return {
      label: `OpenAI Codex quota: ${formatPercent(usedPercent)} used`,
      stale: quotas.openai.stale,
      value: `${Math.round(Math.max(0, Math.min(100, usedPercent)))}%`,
    }
  }

  if (provider === 'glm') {
    const session = quotas.glm.data.find(({ kind }) => kind === 'session')
    const weekly = quotas.glm.data.find(({ kind }) => kind === 'weekly')
    const window = session ?? weekly ?? quotas.glm.data[0]
    if (!window || window.usedPercent === undefined) return undefined
    const sessionValue = session && formatRailPercent(session.usedPercent)
    const weeklyValue = weekly && formatRailPercent(weekly.usedPercent)
    return {
      label: `GLM (Z.AI) quota: ${
        [
          session && sessionValue && `5-hour ${formatPercent(session.usedPercent ?? 0)} used`,
          weekly && weeklyValue && `weekly ${formatPercent(weekly.usedPercent ?? 0)} used`,
        ]
          .filter(Boolean)
          .join('; ')
      }`,
      secondaryValue: sessionValue && weeklyValue ? `7d ${weeklyValue}` : undefined,
      stale: quotas.glm.stale,
      value: sessionValue
        ? `5h ${sessionValue}`
        : weeklyValue
        ? `7d ${weeklyValue}`
        : formatRailPercent(window.usedPercent) ?? '%',
    }
  }

  const window = quotas.copilot.data[0]
  if (!window) return undefined
  const usedPercent = window.used / window.limit * 100
  return {
    label: `GitHub Copilot quota: ${formatPercent(usedPercent)} used`,
    stale: quotas.copilot.stale,
    value: `${Math.round(Math.max(0, Math.min(100, usedPercent)))}%`,
  }
}

function formatRailPercent(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${Math.round(Math.max(0, Math.min(100, value)))}%`
}

function formatPercent(value: number): string {
  return `${
    new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 1 }).format(Math
      .max(0, Math.min(100, value)))
  } %`
}
