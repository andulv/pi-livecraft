import { memo, useState, type ReactNode } from 'react'
import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import { CopyButton } from './CopyButton.tsx'
import { ForkButton } from './ForkButton.tsx'
import { Markdown } from './Markdown.tsx'
import {
  hasVisibleContent,
  providerError,
  reasoningTextForDisplay,
  type ProviderError,
} from './message-display.ts'
import {
  formatCachePercent,
  formatInputTokens,
  formatTokens,
  formatTurnCost,
  formatTurnDuration,
  type MessageUsage,
} from './message-usage.ts'

/** Renders a visible protocol message with the default or custom presentation. */
export const MessageCard = memo(
  function MessageCard(
    { message, onError, onFork, onRetry }: {
      message: JsonObject
      onError: (cause: unknown) => void
      onFork: (entryId: string) => Promise<boolean>
      onRetry?: () => Promise<void>
    },
  ) {
    if (message.role === 'custom' && typeof message.customType === 'string')
      return <DefaultCustomMessage message={message} />
    return (
      <DefaultMessageCard message={message} onError={onError} onFork={onFork} onRetry={onRetry} />
    )
  },
)

const DefaultMessageCard = memo(
  function DefaultMessageCard(
    { message, onError, onFork, onRetry }: {
      message: JsonObject
      onError: (cause: unknown) => void
      onFork: (entryId: string) => Promise<boolean>
      onRetry?: () => Promise<void>
    },
  ) {
    const role = String(message.role)
    const timestamp = typeof message.timestamp === 'number' ? new Date(message.timestamp) : null
    const time = timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null
    const text = visibleText(message.content ?? message.output)
    const forkEntryId = role === 'user' && typeof message.forkEntryId === 'string'
      ? message.forkEntryId
      : undefined
    const failure = providerError(message)
    return (
      <article className={`message ${role}${failure ? ' provider-failure' : ''}`}>
        {(text || forkEntryId) && (
          <div className='conversation-actions message-actions'>
            {forkEntryId && <ForkButton entryId={forkEntryId} onError={onError} onFork={onFork} />}
            {text && <CopyButton label='Copy message' onError={onError} value={text} />}
          </div>
        )}
        <div className='content'>
          {renderContent(message.content ?? message.output, message.role, onError)}
        </div>
        {failure && <ProviderErrorCard failure={failure} onError={onError} onRetry={onRetry} />}
        {role === 'user' && time && (
          <time
            className='message-time'
            dateTime={time.toISOString()}
          >
            {time.toLocaleString(navigator.language, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </time>
        )}
      </article>
    )
  },
)

/** Explains a failed provider response in place of the silent empty bubble. */
function ProviderErrorCard(
  { failure, onError, onRetry }: {
    failure: ProviderError
    onError: (cause: unknown) => void
    onRetry?: () => Promise<void>
  },
) {
  const [retrying, setRetrying] = useState(false)

  async function retry(): Promise<void> {
    if (!onRetry) return
    setRetrying(true)
    try {
      await onRetry()
    } catch (cause) {
      onError(cause)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className='provider-error' role='alert'>
      <div className='provider-error-copy'>
        <strong>Provider error</strong>
        <span>{failure.errorMessage}</span>
        {failure.model && <small>{failure.model}</small>}
      </div>
      {onRetry && (
        <button
          className='provider-error-retry'
          disabled={retrying}
          onClick={() => void retry()}
          type='button'
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  )
}

/** Renders an unknown custom message without interpreting extension-specific details. */
function DefaultCustomMessage({ message }: { message: JsonObject & { customType?: unknown } }) {
  const content = hasVisibleContent(message.content)
    ? renderContent(message.content, message.role)
    : <p>Message has no displayable content.</p>
  return (
    <article className='message custom-message'>
      <code className='custom-message-type'>{String(message.customType)}</code>
      <div className='content'>{content}</div>
    </article>
  )
}

// Every visible turn renders this footer on each render, so the formatter is built once.
const turnTimeFormat = new Intl.DateTimeFormat(navigator.language, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Displays counters billed by Pi for a completed assistant response. */
export function TurnUsage(
  { model, thinkingLevel, timestamp, turnDurationMs, turnNumber, usage }: {
    model?: string
    thinkingLevel?: string
    timestamp?: number
    turnDurationMs?: number
    turnNumber?: number
    usage: MessageUsage
  },
) {
  const time = timestamp === undefined ? null : new Date(timestamp)
  const validTime = time && !Number.isNaN(time.getTime()) ? time : null
  return (
    <div className='turn-usage'>
      {turnNumber !== undefined && <span>#{turnNumber}</span>}
      {validTime && (
        <time dateTime={validTime.toISOString()}>
          {turnTimeFormat.format(validTime)}
          {turnDurationMs !== undefined && ` (+${formatTurnDuration(turnDurationMs)})`}
        </time>
      )}
      {model && (
        <span>
          Model: {model}
          {thinkingLevel && ` (${thinkingLevel})`}
        </span>
      )}
      {!model && thinkingLevel && <span>Thinking: {thinkingLevel}</span>}
      <span>In {formatInputTokens(usage)} ({formatCachePercent(usage)} cached)</span>
      <span>Out {formatTokens(usage.output)}</span>
      <span>Cost: {formatTurnCost(usage.cost)}</span>
    </div>
  )
}

function visibleText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []
    )
    .join('')
}

/** Renders message content in protocol order, including visible thinking. */
function renderContent(
  content: unknown,
  role: unknown,
  onError?: (cause: unknown) => void,
): ReactNode {
  if (typeof content === 'string')
    return <Markdown copyablePre={role === 'assistant'} onError={onError}>{content}</Markdown>
  if (!Array.isArray(content)) return null
  return (
    <>
      {content.map((part, contentIndex) => {
        if (isImageContent(part))
          return (
            <img
              alt={`Attached image ${contentIndex + 1}`}
              className='message-image'
              key={`image-${contentIndex}`}
              src={`data:${part.mimeType};base64,${part.data}`}
            />
          )
        if (!isObject(part)) return null
        if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim())
          return (
            <ReasoningBlock
              copyablePre={role === 'assistant'}
              key={`reasoning-${contentIndex}`}
              onError={onError}
            >
              {reasoningTextForDisplay(role, part.thinking)}
            </ReasoningBlock>
          )
        if (part.type === 'text' && typeof part.text === 'string')
          return (
            <Markdown
              copyablePre={role === 'assistant'}
              key={`text-${contentIndex}`}
              onError={onError}
            >
              {part.text}
            </Markdown>
          )
        return null
      })}
    </>
  )
}

/** Presents thinking directly in the thread with a subtle hierarchy. */
function ReasoningBlock(
  { children, copyablePre, live = false, onError }: {
    children: string
    copyablePre: boolean
    live?: boolean
    onError?: (cause: unknown) => void
  },
) {
  return (
    <div className={`reasoning${live ? ' conversation-entry' : ''}`}>
      <Markdown copyablePre={copyablePre} onError={onError}>{children}</Markdown>
    </div>
  )
}

function isImageContent(value: unknown): value is JsonObject & { data: string; mimeType: string } {
  return isObject(value) && value.type === 'image' && typeof value.data === 'string' && typeof value
        .mimeType === 'string'
    && /^image\/(?:gif|jpeg|png|webp)$/.test(value.mimeType)
}
