import { useEffect, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import {
  copilotPeriodProgress,
  glmPeakDay,
  quotaPeriodProgress,
  quotaUsagePace,
  quotaUsagePaceBands,
  type QuotaUsagePace,
  type QuotaUsagePaceBands,
} from './quota-display.ts'
import type { QuotaProviderSnapshot, QuotaSnapshot } from '../../../shared/types.ts'

/** Displays normalized quota readings without deducing absent quota from provider responses. */
export function QuotaWidget(
  { quotas, onRefresh }: { quotas: QuotaSnapshot | null; onRefresh: () => Promise<void> },
) {
  const [refreshing, setRefreshing] = useState(false)
  const now = useCurrentTime()
  const updatedAt = Math.max(
    quotas?.openai.updatedAt ?? 0,
    quotas?.copilot.updatedAt ?? 0,
    quotas?.glm.updatedAt ?? 0,
  )

  /** Keeps the button disabled until the manual refresh completes, whether success or error. */
  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <header className='widget-header quota-header'>
        <div>
          <strong>Quotas</strong>
          <span>{updatedAt ? `Updated ${formatRelativeDate(updatedAt)}` : 'No reading'}</span>
        </div>
        <Tooltip label='Refresh'>
          <button
            aria-label='Refresh quotas'
            className='git-refresh'
            disabled={refreshing || quotas?.refreshing || quotas?.sessionRequired}
            onClick={() => void refresh()}
            type='button'
          >
            ↻
          </button>
        </Tooltip>
      </header>
      <div className='widget-content quota-content' aria-busy={refreshing || quotas?.refreshing}>
        {!quotas ? <QuotaSkeleton /> : (
          <>
            {quotas.sessionRequired && (
              <p className='quota-empty'>Open a Pi session to read quotas.</p>
            )}
            <ProviderSection name='OpenAI Codex' provider={quotas.openai}>
              {quotas.openai.data.map((window) => {
                const periodProgress = quotaPeriodProgress(window.period, window.resetsAt, now)
                const usedPercent = 100 - window.remainingPercent
                const paceBands = periodProgress === undefined
                  ? undefined
                  : quotaUsagePaceBands(periodProgress)
                const pace = paceBands === undefined
                  ? undefined
                  : quotaUsagePace(usedPercent, periodProgress ?? 0)
                return (
                  <div className='quota-row' key={window.period}>
                    <div className='quota-row-copy'>
                      <strong>{window.period === '5h' ? '5-hour window' : '7-day window'}</strong>
                      <b>{formatPercent(usedPercent)} used</b>
                    </div>
                    <div className='quota-bars'>
                      <QuotaBar
                        label={`${formatPercent(usedPercent)} used`}
                        pace={pace}
                        paceBands={paceBands}
                        value={usedPercent}
                      />
                      {periodProgress !== undefined && (
                        <QuotaBar
                          label={`${formatPercent(periodProgress)} of the ${
                            window.period === '5h' ? '5-hour' : '7-day'
                          } period elapsed`}
                          period
                          value={periodProgress}
                        />
                      )}
                    </div>
                    {window.resetsAt && <small>Reset {formatReset(window.resetsAt)}</small>}
                  </div>
                )
              })}
            </ProviderSection>
            <ProviderSection name='GitHub Copilot' provider={quotas.copilot}>
              {quotas.copilot.data.map((window) => {
                const periodProgress = copilotPeriodProgress(window.resetsAt, now)
                const usedPercent = window.used / window.limit * 100
                const paceBands = periodProgress === undefined
                  ? undefined
                  : quotaUsagePaceBands(periodProgress)
                const pace = paceBands === undefined
                  ? undefined
                  : quotaUsagePace(usedPercent, periodProgress ?? 0)
                return (
                  <div className='quota-row' key={window.name}>
                    <div className='quota-row-copy'>
                      <strong>{window.name}</strong>
                      <b>{formatNumber(window.used)} / {formatNumber(window.limit)}</b>
                    </div>
                    <div className='quota-bars'>
                      <QuotaBar
                        label={`${formatNumber(window.used)} used of ${formatNumber(window.limit)}`}
                        pace={pace}
                        paceBands={paceBands}
                        value={usedPercent}
                      />
                      {periodProgress !== undefined && (
                        <QuotaBar
                          label={`${formatPercent(periodProgress)} of the monthly period elapsed`}
                          period
                          value={periodProgress}
                        />
                      )}
                    </div>
                    {window.resetsAt && <small>Reset {formatReset(window.resetsAt)}</small>}
                  </div>
                )
              })}
            </ProviderSection>
            <ProviderSection name='GLM (Z.AI)' provider={quotas.glm}>
              {quotas.glm.data.map((window) => {
                const isPercent = window.kind === 'session' || window.kind === 'weekly'
                const periodProgress = quotaPeriodProgress(window.kind, window.resetsAt, now)
                const paceBands = isPercent && periodProgress !== undefined
                  ? quotaUsagePaceBands(periodProgress)
                  : undefined
                const pace = paceBands === undefined
                  ? undefined
                  : quotaUsagePace(window.usedPercent ?? 0, periodProgress ?? 0)
                return (
                  <div className='quota-row' key={window.kind}>
                    <div className='quota-row-copy'>
                      <strong>{glmLabel(window.kind)}</strong>
                      <b>
                        {isPercent
                          ? `${formatPercent(window.usedPercent ?? 0)} used`
                          : `${formatNumber(window.used ?? 0)} / ${
                            formatNumber(window.limit ?? 0)
                          }`}
                      </b>
                    </div>
                    <div className='quota-bars'>
                      <QuotaBar
                        label={isPercent
                          ? `${formatPercent(window.usedPercent ?? 0)} used`
                          : `${formatNumber(window.used ?? 0)} used of ${
                            formatNumber(window.limit ?? 0)
                          }`}
                        pace={pace}
                        paceBands={paceBands}
                        value={isPercent
                          ? window.usedPercent ?? 0
                          : window.limit
                          ? (window.used ?? 0) / window.limit * 100
                          : 0}
                      />
                      {periodProgress !== undefined && (
                        <QuotaBar
                          label={`${formatPercent(periodProgress)} of the ${
                            window.kind === 'session' ? '5-hour' : '7-day'
                          } period elapsed`}
                          period
                          value={periodProgress}
                        />
                      )}
                    </div>
                    {window.resetsAt && <small>Reset {formatReset(window.resetsAt)}</small>}
                  </div>
                )
              })}
              {quotas.glm.data.length > 0 && <GlmPeakHoursBar now={now} />}
            </ProviderSection>
            <p className='quota-now'>Now {formatNow(now)}</p>
          </>
        )}
      </div>
    </>
  )
}

function ProviderSection(
  { children, name, provider }: {
    children: React.ReactNode
    name: string
    provider: QuotaProviderSnapshot<unknown>
  },
) {
  return (
    <section className='quota-provider' aria-label={name}>
      <div className='quota-provider-heading'>
        <h2>{name}</h2>
        {provider.stale && <span>Stale reading</span>}
      </div>
      {children}
      {provider.data.length === 0 && !provider.error && (
        <p className='quota-provider-empty'>No quota data available.</p>
      )}
      {provider.error && <p className='quota-error' role='status'>{provider.error}</p>}
    </section>
  )
}

function glmLabel(kind: string): string {
  if (kind === 'session') return 'Session (5-hour)'
  if (kind === 'weekly') return 'Weekly (7-day)'
  if (kind === 'web-searches') return 'Web searches (monthly)'
  return kind
}

function QuotaBar(
  {
    caption,
    label,
    pace,
    paceBands,
    period = false,
    value,
  }: {
    caption?: string
    label: string
    pace?: QuotaUsagePace
    paceBands?: QuotaUsagePaceBands
    period?: boolean
    value: number
  },
) {
  const bounded = Math.min(100, Math.max(0, value))
  const fillStyle = usageFillStyle(bounded, paceBands)
  return (
    <div className='quota-bar-row'>
      <span className='quota-bar-label'>{caption ?? (period ? 'Period' : 'Usage')}</span>
      <div
        aria-label={pace ? `${label}; ${paceLabel(pace)}` : label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(bounded)}
        className={`quota-bar${period ? ' quota-bar-period' : ''}`}
        role='progressbar'
      >
        <span style={fillStyle} />
      </div>
    </div>
  )
}

/** Updates elapsed-period bars even when quota data is not refreshed. */
function useCurrentTime(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])
  return now
}

const dayMs = 86_400_000

/** Shows when Z.AI's ×3 peak pricing applies across the local day. */
function GlmPeakHoursBar({ now }: { now: number }) {
  const { dayStart, nowFraction, peakSegments } = glmPeakDay(
    now,
    -new Date(now).getTimezoneOffset(),
  )
  const windowLabel = peakSegments
    .map((segment) =>
      `${formatHour(dayStart + segment.start * dayMs)}–${
        formatHour(dayStart + segment.end * dayMs)
      }`
    )
    .join(' + ')
  const inPeak = peakSegments.some((s) => nowFraction >= s.start && nowFraction < s.end)
  return (
    <div className='quota-peak'>
      <div
        aria-label={`Z.AI peak pricing ×3 between ${windowLabel} local time; currently ${
          inPeak ? 'in peak hours' : 'off-peak'
        }`}
        className='quota-peak-track'
        role='img'
      >
        {[0.25, 0.5, 0.75].map((tick) => (
          <span className='quota-peak-tick' key={tick} style={{ left: `${tick * 100}%` }} />
        ))}
        {peakSegments.map((segment) => (
          <span
            className='quota-peak-block'
            key={`${segment.start}-${segment.end}`}
            style={{
              left: `${segment.start * 100}%`,
              width: `${(segment.end - segment.start) * 100}%`,
            }}
          />
        ))}
        <span className='quota-peak-now' style={{ left: `${nowFraction * 100}%` }} />
      </div>
      <small>Peak ×3 · {windowLabel} local</small>
    </div>
  )
}

function usageFillStyle(
  value: number,
  paceBands: QuotaUsagePaceBands | undefined,
): { background?: string; width: string } {
  if (!paceBands || value === 0) return { width: `${value}%` }
  const onTrackStop = Math.min(100, paceBands.onTrackLimit / value * 100)
  const cautionStop = Math.min(100, paceBands.cautionLimit / value * 100)
  return {
    width: `${value}%`,
    background:
      `linear-gradient(to right, var(--success) 0 ${onTrackStop}%, var(--warning) ${onTrackStop}% ${cautionStop}%, var(--danger) ${cautionStop}% 100%)`,
  }
}

function paceLabel(pace: QuotaUsagePace): string {
  if (pace === 'on-track') return 'comfortably within the period pace'
  if (pace === 'caution') return 'near or slightly ahead of the period pace'
  return 'well ahead of the period pace'
}

function QuotaSkeleton() {
  return (
    <div aria-label='Loading quotas' className='quota-skeleton' role='status'>
      <span />
      <span />
      <span />
    </div>
  )
}

function formatRelativeDate(timestamp: number): string {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (elapsedMinutes < 1) return 'just now'
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`
  return new Intl.DateTimeFormat(navigator.language, { dateStyle: 'short', timeStyle: 'short' })
    .format(timestamp)
}

function formatReset(timestamp: number): string {
  return new Intl.DateTimeFormat(navigator.language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
    .format(timestamp)
}

function formatNow(timestamp: number): string {
  return new Intl.DateTimeFormat(navigator.language, {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
    .format(timestamp)
}

function formatHour(timestamp: number): string {
  return new Intl.DateTimeFormat(navigator.language, { hour: '2-digit', minute: '2-digit' })
    .format(timestamp)
}

function formatPercent(value: number): string {
  return `${
    new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 1 }).format(value)
  } %`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 0 }).format(value)
}
