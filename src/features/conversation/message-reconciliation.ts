import { isObject } from '../../../shared/is-object.ts'
import type { JsonObject } from '../../../shared/types.ts'
import { toolCallsInMessage, type ToolCall } from './tool-protocol.ts'

export type AssistantTurnPart = { kind: 'message'; message: JsonObject } | {
  kind: 'tool'
  call: ToolCall
}

export interface LiveMessage {
  id: string
  message: JsonObject
}

export type ConversationMessageEntry =
  | { key: string; message: JsonObject; source: 'history'; historyIndex: number }
  | { key: string; message: JsonObject; source: 'live' }

/** Matches assistant messages by role, timestamp when available, and serialized content. */
export function sameAssistantMessage(left: JsonObject, right: JsonObject): boolean {
  if (left.role !== 'assistant' || right.role !== 'assistant') return false
  if (
    typeof left.timestamp === 'number' && typeof right.timestamp === 'number'
    && left.timestamp !== right.timestamp
  ) return false
  const leftContent = left.content ?? left.output
  const rightContent = right.content ?? right.output
  return leftContent !== undefined && rightContent !== undefined
    && JSON.stringify(leftContent) === JSON.stringify(rightContent)
}

/** Extracts the concatenated text from a user message's content, or null when no text is present. */
function extractUserText(message: JsonObject): string | null {
  if (message.role !== 'user') return null
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { type: string; text: string } =>
        isObject(part) && part.type === 'text' && typeof part.text === 'string'
      )
      .map((part) => part.text)
      .join('')
    return text || null
  }
  return null
}

/** Matches messages so optimistic users reconcile with history and assistants retain their identity. */
export function sameMessage(left: JsonObject, right: JsonObject): boolean {
  if (left.role === 'user' && right.role === 'user') {
    const leftText = extractUserText(left)
    const rightText = extractUserText(right)
    return leftText !== null && rightText !== null && leftText === rightText
  }
  return sameAssistantMessage(left, right)
}

/** Merges history and streamed messages while retaining each streamed message's React identity. */
export function conversationMessageEntries(
  historyMessages: JsonObject[],
  liveMessages: LiveMessage[],
): ConversationMessageEntry[] {
  const unmatchedLive = [...liveMessages]
  const historyEntries = historyMessages.map((message, historyIndex): ConversationMessageEntry => {
    const liveIndex = unmatchedLive.findIndex((live) => sameMessage(message, live.message))
    const live = liveIndex < 0 ? undefined : unmatchedLive.splice(liveIndex, 1)[0]
    return {
      key: live?.id ?? `history-${String(message.timestamp ?? '')}-${historyIndex}`,
      message,
      source: 'history',
      historyIndex,
    }
  })
  return [
    ...historyEntries,
    ...unmatchedLive.map(({ id, message }) => ({ key: id, message, source: 'live' as const })),
  ]
}

/** Returns assistant content before the tool calls belonging to that message. */
export function assistantTurnParts(message: JsonObject): AssistantTurnPart[] {
  return [
    { kind: 'message', message },
    ...toolCallsInMessage(message).map((call) => ({ kind: 'tool' as const, call })),
  ]
}
