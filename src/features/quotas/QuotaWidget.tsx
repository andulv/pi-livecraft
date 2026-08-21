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
            <ProviderSection icon={<OpenAiIcon />} name='OpenAI Codex' provider={quotas.openai}>
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
            <ProviderSection icon={<CopilotIcon />} name='GitHub Copilot' provider={quotas.copilot}>
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
            <ProviderSection icon={<ZaiIcon />} name='GLM (Z.AI)' provider={quotas.glm}>
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
            <p className='quota-now'>Now {formatNowDate(now)} · {formatNow(now)}</p>
          </>
        )}
      </div>
    </>
  )
}

function ProviderSection(
  { children, icon, name, provider }: {
    children: React.ReactNode
    icon: React.ReactNode
    name: string
    provider: QuotaProviderSnapshot<unknown>
  },
) {
  return (
    <section className='quota-provider' aria-label={name}>
      <div className='quota-provider-heading'>
        <h2>
          <span aria-hidden='true' className='quota-provider-icon'>{icon}</span>
          {name}
        </h2>
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

/** OpenAI blossom mark, the provider's current brand symbol. */
function OpenAiIcon() {
  return (
    <svg aria-hidden='true' fill='currentColor' height='13' viewBox='0 0 20 20' width='13'>
      <path d='M11.248 18.25q-.825 0-1.568-.314a4.3 4.3 0 0 1-1.32-.874 4 4 0 0 1-1.304.214 4 4 0 0 1-2.046-.544 4.27 4.27 0 0 1-1.518-1.485 4 4 0 0 1-.56-2.095q0-.48.131-1.04A4.4 4.4 0 0 1 2.04 10.71a4.07 4.07 0 0 1 .017-3.4 4.2 4.2 0 0 1 1.056-1.418 3.8 3.8 0 0 1 1.6-.842 3.9 3.9 0 0 1 .76-1.683q.593-.759 1.451-1.188a4.04 4.04 0 0 1 1.832-.429q.825 0 1.567.313.742.314 1.32.875a4 4 0 0 1 1.304-.215q1.106 0 2.046.545a4.14 4.14 0 0 1 1.501 1.485q.578.941.578 2.095 0 .48-.132 1.04.66.61 1.023 1.419.363.792.363 1.666 0 .892-.38 1.717a4.3 4.3 0 0 1-1.072 1.435 3.8 3.8 0 0 1-1.584.825 3.8 3.8 0 0 1-.775 1.683 4.06 4.06 0 0 1-1.436 1.188 4.04 4.04 0 0 1-1.832.429m-4.076-2.062q.825 0 1.435-.347l3.103-1.782a.36.36 0 0 0 .164-.313v-1.42L7.881 14.62a.67.67 0 0 1-.726 0l-3.118-1.798a.5.5 0 0 1-.017.115v.198q0 .841.396 1.551.413.693 1.139 1.089a3.2 3.2 0 0 0 1.617.412m.165-2.69a.4.4 0 0 0 .181.05q.083 0 .165-.05l1.238-.71-3.977-2.31a.7.7 0 0 1-.363-.643v-3.58q-.825.362-1.32 1.122a2.9 2.9 0 0 0-.495 1.65q0 .809.413 1.55.412.743 1.072 1.123zm3.91 3.663q.875 0 1.585-.396a2.96 2.96 0 0 0 1.534-2.64v-3.564a.32.32 0 0 0-.165-.297l-1.254-.726v4.604a.7.7 0 0 1-.363.643l-3.119 1.799a3 3 0 0 0 1.783.577m.627-6.039V8.878L10.01 7.822 8.129 8.878v2.244l1.881 1.056zM7.057 5.859a.7.7 0 0 1 .363-.644l3.119-1.798a3 3 0 0 0-1.782-.578q-.874 0-1.584.396A2.96 2.96 0 0 0 6.05 4.324a3.07 3.07 0 0 0-.396 1.551v3.547q0 .199.165.314l1.237.726zm8.383 7.887q.825-.364 1.303-1.123.495-.758.495-1.65a3.15 3.15 0 0 0-.412-1.55q-.413-.743-1.073-1.123l-3.086-1.782q-.099-.065-.181-.049a.3.3 0 0 0-.165.05l-1.238.692 3.993 2.327a.6.6 0 0 1 .264.264.64.64 0 0 1 .1.363zm-3.317-8.382a.63.63 0 0 1 .726 0l3.135 1.831v-.297q0-.792-.396-1.501a2.86 2.86 0 0 0-1.105-1.155q-.71-.43-1.65-.43-.825 0-1.436.347L8.294 5.941a.36.36 0 0 0-.165.314v1.418z' />
    </svg>
  )
}

/** GitHub Copilot mark from the provider's brand set. */
function CopilotIcon() {
  return (
    <svg aria-hidden='true' fill='currentColor' height='13' viewBox='0 0 24 24' width='13'>
      <path d='M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z' />
    </svg>
  )
}

/** Z.AI bolt mark from the provider's brand set. */
function ZaiIcon() {
  return (
    <svg aria-hidden='true' fill='currentColor' height='13' viewBox='0 0 24 24' width='13'>
      <path d='M12.606 1.806l-1.677 2.388c-0.258 0.374-0.697 0.606-1.161 0.606h-9.162V1.794C0.594 1.806 12.606 1.806 12.606 1.806zM24 1.806L9.6 22.206 0 22.206 14.4 1.806zM11.394 22.206l1.69-2.4c0.258-0.374 0.697-0.606 1.161-0.606h9.149v3.006H11.394z' />
    </svg>
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
  const markers = hourMarkers(dayStart, peakSegments)
  return (
    <div className='quota-peak'>
      <h3>Pricing</h3>
      <div aria-hidden='true' className='quota-peak-labels'>
        {markers.map((marker) => (
          <span
            className={`quota-peak-hour${marker.edge ? ` quota-peak-hour-${marker.edge}` : ''}`}
            key={marker.fraction}
            style={{ left: `${marker.fraction * 100}%` }}
          >
            {marker.label}
          </span>
        ))}
      </div>
      <div
        aria-label={`Z.AI peak pricing ×3 on Singapore weekdays between ${windowLabel} local time; currently ${
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
            className={`quota-peak-block${
              nowFraction >= segment.start && nowFraction < segment.end ? ' active' : ''
            }`}
            key={`${segment.start}-${segment.end}`}
            style={{
              left: `${segment.start * 100}%`,
              width: `${(segment.end - segment.start) * 100}%`,
            }}
          />
        ))}
        <span className='quota-peak-now' style={{ left: `${nowFraction * 100}%` }} />
      </div>
      <div aria-hidden='true' className='quota-peak-labels'>
        {peakSegments.map((segment) => (
          <span
            className='quota-peak-word'
            key={`${segment.start}-${segment.end}`}
            style={{ left: `${(segment.start + segment.end) / 2 * 100}%` }}
          >
            peak
          </span>
        ))}
      </div>
      <small className='quota-peak-note'>{peakNote(now, windowLabel)}</small>
    </div>
  )
}

const singaporeOffsetMs = 8 * 3_600_000

/**
 * The weekday peak window stated in Z.AI's terms, with its times converted to
 * the user's zone: "Peak hours: Monday to Friday, 14:00–18:00 Singapore
 * Standard Time (UTC+8)." becomes e.g. "… 07:00–11:00 (UTC+8 14:00–18:00)".
 */
function peakNote(now: number, windowLabel: string): string {
  const start = new Intl.DateTimeFormat(navigator.language, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  })
    .format(now + singaporeOffsetMs)
  // Both Singapore times come from the same wall clock: shift by the zone gap.
  const localStart = shiftSingaporeHour(now, 14)
  const localEnd = shiftSingaporeHour(now, 18)
  if (localStart === null || localEnd === null)
    return `Peak hours: Monday to Friday, ${windowLabel}.`
  return `Peak hours: Monday to Friday, ${localStart}–${localEnd} local (${start} Singapore, UTC+8).`
}

/** Formats 14:00/18:00 Singapore time in the user's zone for a nearby `now`. */
function shiftSingaporeHour(now: number, singaporeHour: number): string | null {
  const reference = now - (now + singaporeOffsetMs) % dayMs
  const timestamp = reference + singaporeHour * 3_600_000
  const formatter = new Intl.DateTimeFormat(navigator.language, {
    hour: '2-digit',
    minute: '2-digit',
  })
  return formatter.format(timestamp)
}

const fixedMarkerHours = [0, 4, 8, 12, 16, 20, 24]

interface PeakHourMarker {
  edge: 'end' | 'start' | undefined
  fraction: number
  label: string
}

/** Hour labels every four hours, plus peak boundaries that fall between them. */
function hourMarkers(
  dayStart: number,
  peakSegments: ReadonlyArray<{ end: number; start: number }>,
): PeakHourMarker[] {
  const byFraction = new Map<number, PeakHourMarker>()
  for (const hour of fixedMarkerHours) {
    byFraction.set(hour / 24, {
      fraction: hour / 24,
      label: hour === 24 ? '24' : formatHourShort(dayStart + hour * 3_600_000),
      edge: hour === 0 ? 'start' : hour === 24 ? 'end' : undefined,
    })
  }
  for (const segment of peakSegments) {
    for (const fraction of [segment.start, segment.end]) {
      if (!byFraction.has(fraction)) {
        byFraction.set(fraction, {
          fraction,
          label: formatHourShort(dayStart + fraction * dayMs),
          edge: fraction <= 0 ? 'start' : fraction >= 1 ? 'end' : undefined,
        })
      }
    }
  }
  return [...byFraction.values()].sort((left, right) => left.fraction - right.fraction)
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
    weekday: 'short',
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

function formatNowDate(timestamp: number): string {
  return new Intl.DateTimeFormat(navigator.language, { dateStyle: 'full' })
    .format(timestamp)
}

function formatHour(timestamp: number): string {
  return new Intl.DateTimeFormat(navigator.language, { hour: '2-digit', minute: '2-digit' })
    .format(timestamp)
}

function formatHourShort(timestamp: number): string {
  return new Intl.DateTimeFormat(navigator.language, { hour: '2-digit', hourCycle: 'h23' })
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
