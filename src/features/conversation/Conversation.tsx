import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type WheelEvent } from 'react'
import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import { activityActionText, activityAgentName, type Activity } from './activity.ts'
import { formatTokens, formatTurnCost, turnUsageByMessage, type MessageUsage } from './message-usage.ts'
import { assistantTurnParts, conversationMessageEntries, type LiveMessage } from './message-reconciliation.ts'
import { toolCallsInMessage, toolResultInMessage, type ToolExecution } from './tool-protocol.ts'
import type { SessionAnalysisTarget } from '../session-analysis/session-analysis.ts'
import { outputContextDraft } from './context-session.ts'
import { ContextSessionButton, Markdown, ToolCallCard } from './ToolCallCard.tsx'
import { resumesAutoScrollAfterDownwardScroll } from './conversation-scroll.ts'

/** Assembles history, the live stream, and tool executions according to the selected detail level. */
export function Conversation({ activity, agentName, messages, liveMessages, darkMode, detailedView, navigationRequest, pendingSteering, repositoryRoot, scrollToBottomRequest, toolExecutions, workspacePath, onError, onStartSession }: {
  activity: Activity | null
  agentName?: string
  messages: JsonObject[]
  liveMessages: LiveMessage[]
  darkMode: boolean
  detailedView: boolean
  navigationRequest?: { id: number; target: SessionAnalysisTarget }
  pendingSteering: string[]
  repositoryRoot?: string | null
  scrollToBottomRequest: number
  toolExecutions: ToolExecution[]
  workspacePath: string
  onError: (cause: unknown) => void
  onStartSession: (draft: string) => Promise<void>
}) {
  const allMessages = messages
  const { visibleMessages, usagesByMessage, turnNumbers, toolCallIds, resultsByCallId } = useMemo(() => {
    const visible = allMessages.filter(isVisibleConversationMessage)
    const calls = allMessages.flatMap(toolCallsInMessage)
    const results = new Map(allMessages.flatMap((message) => {
      const result = toolResultInMessage(message)
      return result ? [[result.toolCallId, result] as const] : []
    }))
    const usagesByMessage = turnUsageByMessage(allMessages)
    const turnNumbers = new Map<number, number>()
    let turnNum = 0
    for (const idx of [...usagesByMessage.keys()].sort((a, b) => a - b)) turnNumbers.set(idx, ++turnNum)
    return {
      visibleMessages: visible,
      usagesByMessage,
      turnNumbers,
      toolCallIds: new Set(calls.map((call) => call.id)),
      resultsByCallId: results,
    }
  }, [allMessages])
  const executionsByCallId = useMemo(() => new Map(toolExecutions.map((execution) => [execution.id, execution])), [toolExecutions])
  const liveToolCallIds = useMemo(() => new Set(liveMessages.flatMap(({ message }) => toolCallsInMessage(message)).map((call) => call.id)), [liveMessages])
  const messageEntries = useMemo(() => conversationMessageEntries(allMessages, liveMessages), [allMessages, liveMessages])
  const visibleLiveMessages = messageEntries.filter((entry) => entry.source === 'live')
  const conversationRef = useRef<HTMLDivElement>(null)
  const conversationContentRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const previousScrollTopRef = useRef(0)
  /** Prevents onScroll from re-enabling auto-scroll during a navigation scroll. */
  const navigationInProgressRef = useRef(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [highlightedTarget, setHighlightedTarget] = useState<string>()

  /** Keeps a followed conversation pinned to its latest rendered content before paint. */
  const scrollToLiveBottom = useCallback(() => {
    const conversation = conversationRef.current
    if (!autoScrollRef.current || !conversation) return
    conversation.scrollTop = conversation.scrollHeight
    previousScrollTopRef.current = conversation.scrollTop
  }, [])

  useEffect(() => {
    const content = conversationContentRef.current
    if (!content) return
    const observer = new ResizeObserver(scrollToLiveBottom)
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollToLiveBottom])

  useLayoutEffect(scrollToLiveBottom, [activity, liveMessages, pendingSteering.length, scrollToLiveBottom, toolExecutions, visibleMessages.length])

  useEffect(() => {
    if (scrollToBottomRequest > 0) resumeAutoScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToBottomRequest])

  useEffect(() => {
    if (!navigationRequest) return
    const targetKey = navigationTargetKey(navigationRequest.target)
    const selector = navigationRequest.target.kind === 'tool'
      ? `[data-tool-call-id="${CSS.escape(navigationRequest.target.id)}"]`
      : `[data-message-index="${navigationRequest.target.index}"]`
    const conversation = conversationRef.current
    const target = conversation?.querySelector<HTMLElement>(selector)
    if (!conversation || !target) return
    autoScrollRef.current = false
    navigationInProgressRef.current = true
    setShowScrollToBottom(true)
    let cancelled = false
    let finished = false
    let highlightTimeout: number | undefined
    let fallbackRaf: number | undefined
    const finishNavigation = () => {
      if (cancelled || finished) return
      finished = true
      window.cancelAnimationFrame(fallbackRaf ?? 0)
      conversation.removeEventListener('scrollend', finishNavigation)
      navigationInProgressRef.current = false
      setHighlightedTarget(targetKey)
      highlightTimeout = window.setTimeout(() => {
        if (!cancelled) setHighlightedTarget(undefined)
      }, 1500)
    }
    // Wait two frames for the target to mount and its layout to settle before scrolling.
    requestAnimationFrame(() => {
      if (cancelled) return
      requestAnimationFrame(() => {
        if (cancelled) return
        conversation.addEventListener('scrollend', finishNavigation)
        target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: navigationRequest.target.kind === 'tool' ? 'center' : 'end' })
        // Fallback for browsers without scrollend: poll until position stabilizes.
        let stableFrames = 0
        let lastTop = conversation.scrollTop
        const poll = () => {
          if (cancelled || finished) return
          if (conversation.scrollTop === lastTop) {
            stableFrames += 1
            if (stableFrames >= 3) { finishNavigation(); return }
          } else {
            lastTop = conversation.scrollTop
            stableFrames = 0
          }
          fallbackRaf = requestAnimationFrame(poll)
        }
        fallbackRaf = requestAnimationFrame(poll)
      })
    })
    return () => {
      cancelled = true
      conversation.removeEventListener('scrollend', finishNavigation)
      window.cancelAnimationFrame(fallbackRaf ?? 0)
      window.clearTimeout(highlightTimeout)
      navigationInProgressRef.current = false
    }
  }, [navigationRequest])

  /** Resumes automatic scrolling only when the user scrolls downward back near the bottom. */
  function handleConversationScroll(): void {
    const el = conversationRef.current
    if (!el) return
    const previousScrollTop = previousScrollTopRef.current
    previousScrollTopRef.current = el.scrollTop
    if (navigationInProgressRef.current) return
    if (el.scrollTop < previousScrollTop) {
      suspendAutoScroll()
      return
    }
    if (autoScrollRef.current || !resumesAutoScrollAfterDownwardScroll(previousScrollTop, el.scrollTop, el.scrollHeight, el.clientHeight)) return
    autoScrollRef.current = true
    setShowScrollToBottom(false)
  }

  /** Suspends following only for input that can move the viewport away from the response. */
  function suspendAutoScroll(): void {
    autoScrollRef.current = false
    const conversation = conversationRef.current
    if (conversation) previousScrollTopRef.current = conversation.scrollTop
    setShowScrollToBottom(true)
  }

  function handleConversationWheel(event: WheelEvent<HTMLDivElement>): void {
    if (event.deltaY < 0) suspendAutoScroll()
  }

  function handleConversationKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) suspendAutoScroll()
  }

  /** Resumes automatic scrolling and returns to the bottom of the conversation. */
  function resumeAutoScroll(): void {
    autoScrollRef.current = true
    setShowScrollToBottom(false)
    const conversation = conversationRef.current
    if (!conversation) return
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    conversation.scrollTo({ top: conversation.scrollHeight, behavior })
  }

  return (
    <section
      aria-live="polite"
      className="conversation"
      onKeyDown={handleConversationKeyDown}
      onPointerMove={(event) => { if (event.buttons > 0) suspendAutoScroll() }}
      onScroll={handleConversationScroll}
      onTouchMove={suspendAutoScroll}
      onWheel={handleConversationWheel}
      ref={conversationRef}
      tabIndex={0}
    >
      <div className="conversation-content" ref={conversationContentRef}>
      {messageEntries.map((entry) => {
        const { message } = entry
        if (entry.source === 'history') {
          const index = entry.historyIndex
          const calls = detailedView ? toolCallsInMessage(message) : []
          const usage = usagesByMessage.get(index)
          if (!isVisibleConversationMessage(message) && calls.length === 0) return null
          return <div className={highlightedTarget === `message:${index}` ? 'conversation-target' : undefined} data-message-index={index} key={entry.key}>
            {isVisibleConversationMessage(message) && <MessageCard message={message} onStartSession={onStartSession} />}
            {calls.map((call) => {
              const execution = executionsByCallId.get(call.id)
              const result = resultsByCallId.get(call.id) ?? execution?.result
              return <ToolCallCard args={call.args} darkMode={darkMode} hasResult={result !== undefined} id={call.id} interrupted={execution?.status === 'interrupted'} key={call.id} name={call.name} onError={onError} onStartSession={onStartSession} partialResultContent={execution?.partialResult?.content} repositoryRoot={repositoryRoot} resultContent={result?.content} resultDetails={result?.details} resultError={result?.isError} streaming={execution?.status === 'generating'} targeted={highlightedTarget === `tool:${call.id}`} workspacePath={workspacePath} />
            })}
            {usage && <TurnUsage turnNumber={turnNumbers.get(index)} usage={usage} />}
          </div>
        }

        const parts = assistantTurnParts(message)
        const calls = detailedView ? parts.flatMap((part) => part.kind === 'tool' ? [part.call] : []) : []
        if (!isVisibleConversationMessage(message) && calls.length === 0) return null
        return <div className="conversation-entry" key={entry.key}>
          {parts.map((part) => {
            if (part.kind === 'message') return isVisibleConversationMessage(part.message) ? <MessageCard key="message" message={part.message} onStartSession={onStartSession} /> : null
            if (!detailedView) return null
            const execution = executionsByCallId.get(part.call.id)
            const result = execution?.result
            return <ToolCallCard animateLiveChanges args={part.call.args} darkMode={darkMode} hasResult={result !== undefined} id={part.call.id} interrupted={execution?.status === 'interrupted'} key={part.call.id} name={part.call.name} onError={onError} onStartSession={onStartSession} partialResultContent={execution?.partialResult?.content} repositoryRoot={repositoryRoot} resultContent={result?.content} resultDetails={result?.details} resultError={result?.isError} streaming={execution?.status === 'generating'} targeted={highlightedTarget === `tool:${part.call.id}`} workspacePath={workspacePath} />
          })}
        </div>
      })}
      {detailedView && toolExecutions.filter((execution) => !toolCallIds.has(execution.id) && !liveToolCallIds.has(execution.id)).map((execution) => <ToolCallCard animateLiveChanges args={execution.args} darkMode={darkMode} hasResult={execution.result !== undefined} id={execution.id} interrupted={execution.status === 'interrupted'} key={execution.id} name={execution.name} onError={onError} onStartSession={onStartSession} partialResultContent={execution.partialResult?.content} repositoryRoot={repositoryRoot} resultContent={execution.result?.content} resultDetails={execution.result?.details} resultError={execution.result?.isError} streaming={execution.status === 'generating'} targeted={highlightedTarget === `tool:${execution.id}`} workspacePath={workspacePath} />)}
      {pendingSteering.map((message, index) => <article className="message user pending-steering conversation-entry" key={`${message}-${index}`}>
        <div className="content"><Markdown>{message || 'Image attached'}</Markdown></div>
        <span className="pending-steering-status" role="status"><i aria-hidden="true" />Waiting to steer…</span>
      </article>)}
      {visibleMessages.length === 0 && visibleLiveMessages.length === 0 && pendingSteering.length === 0 && <div className="empty-conversation"><span aria-hidden="true" className="brand-mark large">π</span><h2>Session ready</h2><p>Send a message or use a command from your Pi installation.</p></div>}
      {activity && <div className="conversation-activity"><ActivityIndicator activity={activity} agentName={agentName} /></div>}
      </div>
      <button
        aria-label="Resume automatic scrolling"
        className={`scroll-to-bottom${showScrollToBottom ? ' visible' : ''}`}
        onClick={resumeAutoScroll}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      </button>
    </section>
  )
}

const MessageCard = memo(function MessageCard({ message, onStartSession }: { message: JsonObject; onStartSession: (draft: string) => Promise<void> }) {
  if (message.role === 'custom' && typeof message.customType === 'string') return <DefaultCustomMessage message={message} />
  return <DefaultMessageCard message={message} onStartSession={onStartSession} />
})

const DefaultMessageCard = memo(function DefaultMessageCard({ message, onStartSession }: { message: JsonObject; onStartSession: (draft: string) => Promise<void> }) {
  const role = String(message.role)
  const timestamp = typeof message.timestamp === 'number' ? new Date(message.timestamp) : null
  const time = timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null
  const output = role === 'assistant' ? visibleText(message.content ?? message.output) : ''
  return <article className={`message ${role}`}>
    <div className="content">{renderContent(message.content ?? message.output)}</div>
    {output && <ContextSessionButton onClick={() => onStartSession(outputContextDraft(output))} />}
    {role === 'user' && time && <time className="message-time" dateTime={time.toISOString()}>{time.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' })}</time>}
  </article>
})

/** Renders an unknown custom message without interpreting extension-specific details. */
function DefaultCustomMessage({ message }: { message: JsonObject & { customType?: unknown } }) {
  const content = hasVisibleContent(message.content) ? renderContent(message.content) : <p>Message has no displayable content.</p>
  return <article className="message custom-message">
    <code className="custom-message-type">{String(message.customType)}</code>
    <div className="content">{content}</div>
  </article>
}

/** Displays counters billed by Pi for a completed assistant response. */
function TurnUsage({ turnNumber, usage }: { turnNumber?: number; usage: MessageUsage }) {
  return <dl className="turn-usage">
    {turnNumber !== undefined && <div><dt>Turn</dt><dd>{turnNumber}</dd></div>}
    <div><dt>Cost</dt><dd>{formatTurnCost(usage.cost)}</dd></div>
    <div><dt>Cache read</dt><dd>{formatTokens(usage.cacheRead)}</dd></div>
    <div><dt>Cache miss</dt><dd>{formatTokens(usage.cacheMiss)}</dd></div>
    <div><dt>Output</dt><dd>{formatTokens(usage.output)}</dd></div>
  </dl>
}

/** Displays Pi's current work state in the conversation thread. */
export function ActivityIndicator({ activity, agentName }: { activity: Activity; agentName?: string }) {
  return <div className={`pi-activity is-${activity.kind}`} role="status"><span aria-hidden="true" className="activity-signal"><i /><i /><i /></span><span className="activity-text"><span>{activityAgentName(agentName)}</span>{' '}<span className="activity-action" key={activity.kind}>{activityActionText(activity)}</span></span></div>
}

function isVisibleConversationMessage(message: JsonObject): boolean {
  const role = message.role
  if (role === 'custom') return message.display === true && typeof message.customType === 'string'
  return (role === 'user' || role === 'assistant' || role === 'system') && hasVisibleContent(message.content ?? message.output)
}

function hasVisibleContent(content: unknown): boolean {
  if (typeof content === 'string') return content.trim().length > 0
  return Array.isArray(content) && content.some((part) => isObject(part) && (
    (part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0)
    || (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim().length > 0)
    || isImageContent(part)
  ))
}

function visibleText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => isObject(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('')
}

/** Renders assistant content in order, including visible thinking. */
function renderContent(content: unknown): ReactNode {
  if (typeof content === 'string') return <Markdown>{content}</Markdown>
  if (!Array.isArray(content)) return null
  return <>{content.map((part, contentIndex) => {
    if (isImageContent(part)) return <img alt={`Attached image ${contentIndex + 1}`} className="message-image" key={`image-${contentIndex}`} src={`data:${part.mimeType};base64,${part.data}`} />
    if (!isObject(part)) return null
    if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim()) return <ReasoningBlock key={`reasoning-${contentIndex}`}>{part.thinking}</ReasoningBlock>
    if (part.type === 'text' && typeof part.text === 'string') return <Markdown key={`text-${contentIndex}`}>{part.text}</Markdown>
    return null
  })}</>
}

/** Presents thinking directly in the thread with a subtle hierarchy. */
function ReasoningBlock({ children, live = false }: { children: string; live?: boolean }) {
  return <div className={`reasoning${live ? ' conversation-entry' : ''}`}><Markdown>{children}</Markdown></div>
}

function isImageContent(value: unknown): value is JsonObject & { data: string; mimeType: string } {
  return isObject(value) && value.type === 'image' && typeof value.data === 'string' && typeof value.mimeType === 'string' && /^image\/(?:gif|jpeg|png|webp)$/.test(value.mimeType)
}

function navigationTargetKey(target: SessionAnalysisTarget): string {
  return target.kind === 'tool' ? `tool:${target.id}` : `message:${target.index}`
}
