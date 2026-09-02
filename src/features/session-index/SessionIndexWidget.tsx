import { useMemo } from 'react'
import type { JsonObject } from '../../../shared/types.ts'
import type { ConversationNavigationTarget } from '../conversation/conversation-navigation.ts'
import { formatTokens } from '../conversation/message-usage.ts'
import { WidgetLayout } from '../right-sidebar/WidgetLayout.tsx'
import { sessionIndexEntries, type SessionIndexMetrics } from './session-index.ts'

/** Lists the current session's user messages as navigable conversation anchors. */
export function SessionIndexWidget(
  {
    activeSessionId,
    messages,
    onNavigate,
    requestDurations,
    sessionMessagesAvailable,
  }: {
    activeSessionId: string
    messages: readonly JsonObject[]
    onNavigate: (target: ConversationNavigationTarget) => void
    requestDurations: ReadonlyMap<number, number>
    sessionMessagesAvailable: boolean
  },
) {
  const entries = useMemo(
    () => sessionIndexEntries(messages, { requestDurations }),
    [messages, requestDurations],
  )
  const subtitle = !activeSessionId
    ? 'No session selected'
    : !sessionMessagesAvailable
    ? 'Loading messages…'
    : `${entries.length} user message${entries.length === 1 ? '' : 's'}`

  return (
    <WidgetLayout
      header={
        <div>
          <strong>Session index</strong>
          <span>{subtitle}</span>
        </div>
      }
    >
      <div className='session-index'>
        {!activeSessionId
          ? <p className='session-index-empty'>Choose a session to see its messages.</p>
          : !sessionMessagesAvailable
          ? <p className='session-index-empty' role='status'>Loading session messages…</p>
          : entries.length === 0
          ? <p className='session-index-empty'>No user messages in this session yet.</p>
          : (
            <ol aria-label='User messages' className='session-index-list'>
              {entries.map((entry) => {
                const time = timeForDisplay(entry.timestamp)
                return (
                  <li key={entry.messageIndex}>
                    <button
                      aria-label={`Go to user message ${entry.number}: ${entry.preview}${
                        entry.assistant ? `. Response: ${entry.assistant.preview}` : ''
                      }`}
                      onClick={() => onNavigate({ kind: 'message', index: entry.messageIndex })}
                      title={entry.preview}
                      type='button'
                    >
                      <span aria-hidden='true' className='session-index-number'>
                        {entry.number}
                      </span>
                      <span className='session-index-copy'>
                        <strong>{entry.preview}</strong>
                        {entry.assistant && (
                          <span aria-hidden='true' className='session-index-response'>
                            {entry
                              .assistant
                              .preview}
                          </span>
                        )}
                        {entry.metrics && (
                          <span aria-hidden='true' className='session-index-meta'>
                            {formatTurnMetrics(entry.metrics)}
                          </span>
                        )}
                        {(time || entry.metrics?.durationMs !== undefined) && (
                          <span className='session-index-when'>
                            {time && <time dateTime={time.dateTime}>{time.label}</time>}
                            {entry.metrics?.durationMs !== undefined && (
                              <span aria-hidden='true'>
                                ({formatDurationLabel(
                                  entry
                                    .metrics
                                    .durationMs,
                                )})
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
      </div>
    </WidgetLayout>
  )
}

/** Builds a compact, monospace summary of what the agent did during one turn. */
function formatTurnMetrics(metrics: SessionIndexMetrics): string {
  const count = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`
  const parts: string[] = []
  if (metrics.turns > 0) parts.push(count(metrics.turns, 'turn'))
  if (metrics.toolCalls > 0) {
    const failed = metrics.failedToolCalls > 0
      ? ` (${count(metrics.failedToolCalls, 'failed')})`
      : ''
    parts.push(`${count(metrics.toolCalls, 'tool call')}${failed}`)
  }
  const totalIn = metrics.cacheMiss + metrics.cacheRead + metrics.cacheWrite
  if (totalIn > 0) {
    const cachedPercent = metrics.cacheRead > 0
      ? ` (${Math.round(metrics.cacheRead / totalIn * 100)}% cached)`
      : ''
    parts.push(`in ${formatTokens(totalIn)}${cachedPercent}`)
  }
  if (metrics.output > 0) parts.push(`out ${formatTokens(metrics.output)}`)
  return parts.join(' · ')
}

/** Formats a duration in minutes and seconds, keeping index rows readable. */
function formatDurationLabel(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`
  const totalSeconds = Math.round(durationMs / 1_000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

function timeForDisplay(
  timestamp: number | undefined,
): { dateTime: string; label: string } | undefined {
  if (timestamp === undefined) return undefined
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return {
    dateTime: date.toISOString(),
    label: date.toLocaleString(navigator.language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
  }
}
