import { isObject } from './is-object.ts'
import type { JsonObject } from './types.ts'

/** Reads an assistant message from an event that carries a complete message. */
export function assistantMessageInEvent(event: JsonObject): JsonObject | null {
  return assistantMessage(event.message)
}

/** Applies a public RPC message event to the latest assistant message. */
export function assistantMessageAfterEvent(
  current: JsonObject | null,
  event: JsonObject,
): JsonObject | null {
  const complete = assistantMessageInEvent(event)
  if (complete) return complete
  if (event.type !== 'message_update' || !isObject(event.assistantMessageEvent)) return null

  const update = event.assistantMessageEvent
  const partial = assistantMessage(update.partial)
    ?? assistantMessage(update.message)
    ?? assistantMessage(update.error)
  if (partial) return partial
  if (!current || current.role !== 'assistant') return null

  const index = update.contentIndex
  if (!Number.isSafeInteger(index) || (index as number) < 0) return current
  const content = Array.isArray(current.content) ? [...current.content] : []
  const contentIndex = index as number
  const previous = content[contentIndex]

  switch (update.type) {
    case 'text_start':
      content[contentIndex] = { type: 'text', text: '' }
      break
    case 'text_delta':
      if (typeof update.delta !== 'string') return current
      content[contentIndex] = {
        ...(isObject(previous) ? previous : {}),
        type: 'text',
        text: `${textInBlock(previous)}${update.delta}`,
      }
      break
    case 'text_end':
      if (typeof update.content !== 'string') return current
      content[contentIndex] = {
        ...(isObject(previous) ? previous : {}),
        type: 'text',
        text: update.content,
      }
      break
    case 'thinking_start':
      content[contentIndex] = { type: 'thinking', thinking: '' }
      break
    case 'thinking_delta':
      if (typeof update.delta !== 'string') return current
      content[contentIndex] = {
        ...(isObject(previous) ? previous : {}),
        type: 'thinking',
        thinking: `${thinkingInBlock(previous)}${update.delta}`,
      }
      break
    case 'thinking_end':
      if (typeof update.content !== 'string') return current
      content[contentIndex] = {
        ...(isObject(previous) ? previous : {}),
        type: 'thinking',
        thinking: update.content,
      }
      break
    case 'toolcall_end':
      if (!isObject(update.toolCall) || update.toolCall.type !== 'toolCall') return current
      content[contentIndex] = update.toolCall
      break
    default:
      return current
  }

  return { ...current, content }
}

function assistantMessage(value: unknown): JsonObject | null {
  return isObject(value) && value.role === 'assistant' ? value : null
}

function textInBlock(value: unknown): string {
  return isObject(value) && value.type === 'text' && typeof value.text === 'string'
    ? value.text
    : ''
}

function thinkingInBlock(value: unknown): string {
  return isObject(value) && value.type === 'thinking' && typeof value.thinking === 'string'
    ? value.thinking
    : ''
}
