import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'

const maxSessionIndexPreviewLength = 180
const maxAssistantPreviewLength = 120

export interface SessionIndexAssistant {
  messageIndex: number
  preview: string
}

export interface SessionIndexEntry {
  messageIndex: number
  number: number
  preview: string
  timestamp?: number
  assistant?: SessionIndexAssistant
}

/** Derives chronological turn anchors from a selected session snapshot.
 *
 * Each user message opens a turn. The entry keeps the final assistant response
 * of that turn as a muted preview so turns stay recognizable without reproducing
 * every assistant message, tool call, or tool result. */
export function sessionIndexEntries(messages: readonly JsonObject[]): SessionIndexEntry[] {
  const entries: SessionIndexEntry[] = []
  let current: SessionIndexEntry | undefined
  for (const [messageIndex, message] of messages.entries()) {
    if (message.role === 'user') {
      const timestamp = messageTimestamp(message)
      current = {
        messageIndex,
        number: entries.length + 1,
        preview: userMessagePreview(message),
        ...(timestamp === undefined ? {} : { timestamp }),
      }
      entries.push(current)
      continue
    }
    if (message.role === 'assistant' && current) {
      const text = assistantMessageText(message)
      if (!text.trim()) continue
      const preview = firstResponseLine(text)
      if (preview) current.assistant = { messageIndex, preview }
    }
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
  if (normalized) return truncate(normalized, maxSessionIndexPreviewLength)
  return Array.isArray(content) && content.some((part) => isObject(part) && part.type === 'image')
    ? 'Image attachment'
    : 'Untitled message'
}

/** Joins visible text from an assistant message, excluding thinking and tool calls. */
function assistantMessageText(message: JsonObject): string {
  const content = message.content ?? message.output
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(isObject)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => String(part.text))
    .join('')
}

const headingLine = /^\s{0,3}#{1,6}\s+(.*)$/
const horizontalRuleLine = /^\s*([-*_])(?:\s*\1){2,}\s*$/

/** Returns response lines that are not enclosed in a fenced code block. */
function visibleLines(text: string): string[] {
  const lines: string[] = []
  let fenceMarker = ''
  for (const line of text.split('\n')) {
    if (fenceMarker) {
      if (closingFence(line, fenceMarker)) fenceMarker = ''
      continue
    }
    const opening = openingFence(line)
    if (opening) {
      fenceMarker = opening
      continue
    }
    lines.push(line)
  }
  return lines
}

function openingFence(line: string): string | undefined {
  const match = /^\s*(`{3,}|~{3,})/.exec(line)
  return match ? (match[1][0] === '`' ? '`' : '~') : undefined
}

function closingFence(line: string, marker: string): boolean {
  return new RegExp(`^\\s*${marker}{3,}\\s*$`).test(line)
}

/** Picks a one-line label for a final response: its first Markdown heading, else
 * the first line that is neither blank, a code fence, nor a horizontal rule. */
function firstResponseLine(text: string): string {
  const lines = visibleLines(text)
  for (const line of lines) {
    const match = headingLine.exec(line)
    if (!match) continue
    const heading = match[1].replace(/\s+#+\s*$/, '').trim()
    if (heading) return truncate(heading, maxAssistantPreviewLength)
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || horizontalRuleLine.test(trimmed)) continue
    return truncate(trimmed, maxAssistantPreviewLength)
  }
  return ''
}

function messageTimestamp(message: JsonObject): number | undefined {
  return typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
    ? message.timestamp
    : undefined
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}
