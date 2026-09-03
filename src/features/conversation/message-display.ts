import { isObject } from '../../../shared/is-object.ts'
import { providerFailure, type ProviderFailure } from '../../../shared/provider-failure.ts'
import type { JsonObject } from '../../../shared/types.ts'

export { providerFailure as providerError }
export type { ProviderFailure as ProviderError }

const ESC = String.fromCodePoint(0x1B)
const C1_CSI = String.fromCodePoint(0x9B)
const SGR_SEQUENCE = new RegExp(`(?:${ESC}\\[|${C1_CSI})[0-?]*[ -/]*m`, 'g')

/** Removes terminal SGR styling only from assistant reasoning rendered by the browser. */
export function reasoningTextForDisplay(role: unknown, text: string): string {
  return role === 'assistant' ? text.replace(SGR_SEQUENCE, '') : text
}

/** Accepts only protocol messages whose role and content have a visible thread representation. */
export function isVisibleConversationMessage(message: JsonObject): boolean {
  const role = message.role
  if (role === 'custom') return message.display === true && typeof message.customType === 'string'
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return false
  // A failed provider response carries no content but must stay visible as an error.
  if (role === 'assistant' && providerFailure(message) !== undefined) return true
  return hasVisibleContent(message.content ?? message.output)
}

/** Concatenates the text parts of a user message, for retrying its prompt. */
export function userPromptText(message: JsonObject): string | undefined {
  if (message.role !== 'user') return undefined
  const content = message.content
  if (!Array.isArray(content))
    return typeof content === 'string' && content.trim()
      ? content
      : undefined
  const text = content
    .filter((part): part is { text: string } =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('\n')
    .trim()
  return text || undefined
}

/**
 * Returns empty provider failures superseded by Pi's next automatic retry attempt.
 * Pi persists one assistant error per attempt, but only the final failure is actionable.
 */
export function supersededProviderFailures(
  messages: Iterable<JsonObject>,
): ReadonlySet<JsonObject> {
  const superseded = new Set<JsonObject>()
  let previousFailure: JsonObject | undefined
  for (const message of messages) {
    const isEmptyFailure = providerFailure(message) !== undefined
      && !hasVisibleContent(message.content ?? message.output)
    if (!isEmptyFailure) {
      previousFailure = undefined
      continue
    }
    if (previousFailure) superseded.add(previousFailure)
    previousFailure = message
  }
  return superseded
}

/** Reports whether protocol content contains text, thinking, or a supported inline image. */
export function hasVisibleContent(content: unknown): boolean {
  if (typeof content === 'string') return content.trim().length > 0
  return Array.isArray(content) && content.some((part) =>
    isObject(part) && (
      (part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0)
      || (part.type === 'thinking' && typeof part.thinking === 'string'
        && part.thinking.trim().length > 0)
      || isImageContent(part)
    )
  )
}

function isImageContent(value: unknown): boolean {
  return isObject(value) && value.type === 'image' && typeof value.data === 'string'
    && typeof value.mimeType === 'string'
    && /^image\/(?:gif|jpeg|png|webp)$/.test(value.mimeType)
}
