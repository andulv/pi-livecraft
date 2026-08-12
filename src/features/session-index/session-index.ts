import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'

const maxSessionIndexPreviewLength = 180

export interface SessionIndexEntry {
  messageIndex: number
  number: number
  preview: string
  timestamp?: number
}

/** Derives chronological user-message anchors from a selected session snapshot. */
export function sessionIndexEntries(messages: readonly JsonObject[]): SessionIndexEntry[] {
  const entries: SessionIndexEntry[] = []
  for (const [messageIndex, message] of messages.entries()) {
    if (message.role !== 'user') continue
    const timestamp = messageTimestamp(message)
    entries.push({
      messageIndex,
      number: entries.length + 1,
      preview: userMessagePreview(message),
      ...(timestamp === undefined ? {} : { timestamp }),
    })
  }
  return entries
}

function userMessagePreview(message: JsonObject): string {
  const content = message.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
    ? content
      .flatMap((part) =>
        isObject(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []
      )
      .join(' ')
    : ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized) return truncate(normalized)
  return Array.isArray(content) && content.some((part) => isObject(part) && part.type === 'image')
    ? 'Image attachment'
    : 'Untitled message'
}

function messageTimestamp(message: JsonObject): number | undefined {
  return typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
    ? message.timestamp
    : undefined
}

function truncate(text: string): string {
  return text.length > maxSessionIndexPreviewLength
    ? `${text.slice(0, maxSessionIndexPreviewLength - 1)}…`
    : text
}
