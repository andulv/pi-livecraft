import {
  assistantMessageAfterEvent,
  assistantMessageInEvent,
} from '../shared/assistant-message-stream.ts'
import type { ConversationMessage, JsonObject } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

export interface SequencedPiEvent {
  data: JsonObject
  sequence: number
}

/** Keeps only the current turn events needed to rebuild transient conversation state. */
export class LiveSessionEvents {
  readonly #events = new Map<string, SequencedPiEvent>()
  #assistantMessage: JsonObject | null = null

  receive(data: JsonObject, sequence: number): void {
    const type = data.type
    if (type === 'agent_settled') {
      this.#events.clear()
      this.#assistantMessage = null
      return
    }
    if (type === 'agent_start') this.#events.set('agent', { data, sequence })
    if (type === 'queue_update') this.#events.set('queue', { data, sequence })
    if (type === 'message_start') {
      this.#deletePrefix('message:')
      this.#assistantMessage = assistantMessageInEvent(data)
      this.#events.set('message:start', { data, sequence })
    }
    if (type === 'message_update') {
      const message = assistantMessageAfterEvent(this.#assistantMessage, data)
      if (message) this.#assistantMessage = message
      // RPC deltas omit cumulative messages; retain one assembled message for snapshot replay.
      const storedData = message ? { ...data, message } : data
      this.#events.set('message:update', { data: storedData, sequence })
      const update = isObject(data.assistantMessageEvent) ? data.assistantMessageEvent : undefined
      if (
        (update?.type === 'toolcall_start' || update?.type === 'toolcall_delta' || update
              ?.type === 'toolcall_end')
        && Number.isSafeInteger(update.contentIndex)
      )
        this.#events.set(`message:tool:${String(update.contentIndex)}`, {
          data: storedData,
          sequence,
        })
    }
    if (type === 'message_end') {
      this.#deletePrefix('message:')
      this.#assistantMessage = null
    }
    if (
      (type === 'tool_execution_start' || type === 'tool_execution_update')
      && typeof data.toolCallId === 'string'
    ) {
      this.#events.set(
        `tool:${data.toolCallId}:${type === 'tool_execution_start' ? 'start' : 'update'}`,
        { data, sequence },
      )
    }
    if (type === 'tool_execution_end' && typeof data.toolCallId === 'string')
      this.#deletePrefix(`tool:${data.toolCallId}:`)
    if (type === 'auto_retry_start') this.#events.set('retry', { data, sequence })
    if (type === 'auto_retry_end') this.#events.delete('retry')
  }

  snapshot(): SequencedPiEvent[] {
    return [...new Map([...this.#events.values()].map((event) => [event.sequence, event])).values()]
      .sort((left, right) => left.sequence - right.sequence)
  }

  #deletePrefix(prefix: string): void {
    for (const key of this.#events.keys()) if (key.startsWith(prefix)) this.#events.delete(key)
  }
}

/** Rebuilds the active conversation without dropping messages hidden from Pi by compaction. */
export function activeSessionMessages(
  entries: JsonObject[],
  leafId: unknown,
  forkEntryIds: ReadonlySet<string> = new Set(),
): ConversationMessage[] {
  if (typeof leafId !== 'string') return []
  const entriesById = new Map(
    entries.flatMap((entry) => typeof entry.id === 'string' ? [[entry.id, entry] as const] : []),
  )
  const activeEntries: JsonObject[] = []
  const visited = new Set<string>()
  let id: string | null = leafId
  let thinkingLevel: string | undefined
  while (id && !visited.has(id)) {
    visited.add(id)
    const entry = entriesById.get(id)
    if (!entry) break
    activeEntries.push(entry)
    id = typeof entry.parentId === 'string' ? entry.parentId : null
  }
  return visibleSessionMessages(
    activeEntries.reverse().flatMap((entry) => {
      // Pi records reasoning-effort switches as separate entries; assistant messages
      // themselves do not carry the level they ran with.
      if (entry.type === 'thinking_level_change') {
        if (typeof entry.thinkingLevel === 'string') thinkingLevel = entry.thinkingLevel
        return []
      }
      return messageFromEntry(entry, forkEntryIds).map((message) => {
        const stamped = {
          ...(typeof entry.id === 'string' ? { entryId: entry.id } : {}),
          ...message,
        }
        return message.role === 'assistant' && thinkingLevel !== undefined
            && message.thinkingLevel === undefined
          ? { ...stamped, thinkingLevel }
          : stamped
      })
    }),
  )
}

/** Keeps messages useful to the interface without exposing hidden custom messages. */
export function visibleSessionMessages(messages: JsonObject[]): JsonObject[] {
  return messages.filter((message) =>
    message.role === 'user'
    || message.role === 'assistant'
    || message.role === 'toolResult'
    || (message.role === 'custom' && message.display === true
      && typeof message.customType === 'string')
  )
}

/** Names the current visible history so a client can request only later messages. */
export function snapshotCursor(messages: ConversationMessage[]): string {
  const last = messages.at(-1)
  return `${messages.length}:${typeof last?.entryId === 'string' ? last.entryId : ''}`
}

/** Splits a fresh snapshot for a client holding `since` (`<count>:<last entryId>`).
 *  The cursor is valid only when the exact prefix is still the current active chain:
 *  compaction, a branch change, or an unknown cursor falls back to a full snapshot. */
export function sliceSnapshotDelta(
  messages: ConversationMessage[],
  since: string,
): { mode: 'delta'; appended: ConversationMessage[]; cursor: string } | {
  mode: 'full'
  cursor: string
} {
  const cursor = snapshotCursor(messages)
  const separator = since.indexOf(':')
  if (separator < 0) return { mode: 'full', cursor }
  const count = Number(since.slice(0, separator))
  const entryId = since.slice(separator + 1)
  if (!Number.isInteger(count) || count < 0 || count > messages.length || !entryId)
    return { mode: 'full', cursor }
  const anchor = messages[count - 1]
  if (!anchor || anchor.entryId !== entryId) return { mode: 'full', cursor }
  return { mode: 'delta', appended: messages.slice(count), cursor }
}

function messageFromEntry(
  entry: JsonObject,
  forkEntryIds: ReadonlySet<string>,
): ConversationMessage[] {
  if (entry.type === 'message' && isObject(entry.message)) {
    const forkEntryId = entry.message.role === 'user' && typeof entry.id === 'string'
        && forkEntryIds.has(entry.id)
      ? entry.id
      : undefined
    return [forkEntryId ? { ...entry.message, forkEntryId } : entry.message]
  }
  if (entry.type === 'compaction' && typeof entry.summary === 'string')
    return [{
      role: 'custom',
      customType: 'compaction',
      content: entry.summary,
      display: true,
    }]
  if (entry.type !== 'custom_message' || typeof entry.customType !== 'string') return []
  return [{
    role: 'custom',
    customType: entry.customType,
    content: entry.content,
    display: entry.display,
    details: entry.details,
  }]
}
