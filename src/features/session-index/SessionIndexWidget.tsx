import { useMemo } from 'react'
import type { JsonObject } from '../../../shared/types.ts'
import type { ConversationNavigationTarget } from '../conversation/conversation-navigation.ts'
import { WidgetLayout } from '../right-sidebar/WidgetLayout.tsx'
import { sessionIndexEntries } from './session-index.ts'

/** Lists the current session's user messages as navigable conversation anchors. */
export function SessionIndexWidget(
  {
    activeSessionId,
    messages,
    onNavigate,
    sessionMessagesAvailable,
  }: {
    activeSessionId: string
    messages: readonly JsonObject[]
    onNavigate: (target: ConversationNavigationTarget) => void
    sessionMessagesAvailable: boolean
  },
) {
  const entries = useMemo(() => sessionIndexEntries(messages), [messages])
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
                        {time && <time dateTime={time.dateTime}>{time.label}</time>}
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
