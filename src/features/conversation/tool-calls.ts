import type { JsonObject } from '../../../shared/types.ts'
import { diffWords } from 'diff'
import { isObject } from '../../../shared/is-object.ts'
import { positiveInteger, type ToolCallPresentation } from './tool-call-presentations/shared.ts'
import { toolCallPresentations } from './tool-call-presentations/index.ts'
export { truncateToolText } from './tool-call-presentations/shared.ts'

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  content: unknown
  isError: boolean
  details?: unknown
}

export interface ToolExecutionUpdate {
  toolCallId: string
  toolName: string
  partialResult: ToolResult
}

export interface ToolCallUpdate {
  call: ToolCall
  contentIndex: number
  delta: string
  phase: 'start' | 'delta' | 'end'
}

export interface ToolExecution extends ToolCall {
  contentIndex?: number
  partialResult?: ToolResult
  result?: ToolResult
  status: 'generating' | 'running' | 'interrupted'
}

export type AssistantTurnPart = { kind: 'message'; message: JsonObject } | { kind: 'tool'; call: ToolCall }

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
  if (typeof left.timestamp === 'number' && typeof right.timestamp === 'number' && left.timestamp !== right.timestamp) return false
  const leftContent = left.content ?? left.output
  const rightContent = right.content ?? right.output
  return leftContent !== undefined && rightContent !== undefined && JSON.stringify(leftContent) === JSON.stringify(rightContent)
}

/** Extracts the concatenated text from a user message's content, or null when no text is present. */
function extractUserText(message: JsonObject): string | null {
  if (message.role !== 'user') return null
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { type: string; text: string } => isObject(part) && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
    return text || null
  }
  return null
}

/** Matches two messages by role so optimistic user messages reconcile with history and assistants keep their existing identity. */
export function sameMessage(left: JsonObject, right: JsonObject): boolean {
  if (left.role === 'user' && right.role === 'user') {
    const leftText = extractUserText(left)
    const rightText = extractUserText(right)
    return leftText !== null && rightText !== null && leftText === rightText
  }
  return sameAssistantMessage(left, right)
}

/** Merges history and streamed messages while retaining each streamed message's React identity. */
export function conversationMessageEntries(historyMessages: JsonObject[], liveMessages: LiveMessage[]): ConversationMessageEntry[] {
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
  return [...historyEntries, ...unmatchedLive.map(({ id, message }) => ({ key: id, message, source: 'live' as const }))]
}

export interface ReadContentDisplay {
  kind: 'code' | 'html' | 'markdown' | 'svg' | 'text'
  language?: string
}

export interface ToolEditChange {
  oldText: string
  newText: string
}

/** Extracts every tool call embedded in an assistant message's content array. */
export function toolCallsInMessage(message: JsonObject): ToolCall[] {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return []

  return message.content.flatMap((part) => {
    const call = toolCallFromValue(part)
    return call ? [call] : []
  })
}

/** Returns assistant content before the tool calls belonging to that message. */
export function assistantTurnParts(message: JsonObject): AssistantTurnPart[] {
  return [{ kind: 'message', message }, ...toolCallsInMessage(message).map((call) => ({ kind: 'tool' as const, call }))]
}

/** Extracts each step of a tool call to track its raw arguments while they are generated. */
export function toolCallInUpdate(event: JsonObject): ToolCallUpdate | null {
  if (event.type !== 'message_update' || !isObject(event.assistantMessageEvent)) return null
  const update = event.assistantMessageEvent
  if (update.type !== 'toolcall_start' && update.type !== 'toolcall_delta' && update.type !== 'toolcall_end') return null
  if (!Number.isSafeInteger(update.contentIndex) || (update.contentIndex as number) < 0) return null

  const call = update.type === 'toolcall_end'
    ? toolCallFromValue(update.toolCall)
    : toolCallFromPartial(update.partial, update.contentIndex as number)
  if (!call) return null

  return {
    call,
    contentIndex: update.contentIndex as number,
    delta: update.type === 'toolcall_delta' && typeof update.delta === 'string' ? update.delta : '',
    phase: update.type === 'toolcall_start' ? 'start' : update.type === 'toolcall_delta' ? 'delta' : 'end',
  }
}

/** Applies a streaming step while preserving raw JSON and the call's final identity. */
export function applyToolCallUpdate(executions: ToolExecution[], update: ToolCallUpdate, draftId: string): ToolExecution[] {
  if (update.phase === 'start') {
    const previousInterrupted = executions.map((execution) => execution.status === 'generating' && execution.contentIndex === update.contentIndex
      ? { ...execution, status: 'interrupted' as const }
      : execution)
    return [...previousInterrupted, {
      ...update.call,
      contentIndex: update.contentIndex,
      id: update.call.id || draftId,
      status: 'generating',
    }]
  }

  let matched = false
  const updated = executions.map((execution) => {
    if (matched || execution.status !== 'generating' || execution.contentIndex !== update.contentIndex) return execution
    matched = true
    if (update.phase === 'end') return { ...execution, ...update.call, status: 'running' as const }

    return {
      ...execution,
      ...update.call,
      id: update.call.id || execution.id,
    }
  })
  if (matched) return updated

  return [...executions, {
    ...update.call,
    contentIndex: update.contentIndex,
    id: update.call.id || draftId,
    status: update.phase === 'end' ? 'running' : 'generating',
  }]
}

/** Freezes calls whose generation produced no end event. */
export function interruptToolCallGeneration(executions: ToolExecution[]): ToolExecution[] {
  return executions.map((execution) => execution.status === 'generating'
    ? { ...execution, status: 'interrupted' }
    : execution)
}

/** Extracts a validated tool execution update that carries a partial result from Pi. */
export function toolExecutionUpdateInEvent(event: JsonObject): ToolExecutionUpdate | null {
  if (event.type !== 'tool_execution_update' || typeof event.toolCallId !== 'string' || typeof event.toolName !== 'string') return null
  const partial = event.partialResult
  if (!isObject(partial)) return null
  return {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    partialResult: {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      content: partial.content,
      isError: false,
      details: isObject(partial.details) ? partial.details : undefined,
    },
  }
}

/** Replaces the matching execution's partial result without touching executions that are already settled. */
export function applyToolExecutionUpdate(executions: ToolExecution[], update: ToolExecutionUpdate): ToolExecution[] {
  return executions.map((execution) => {
    if (execution.id !== update.toolCallId || execution.status !== 'running' || execution.result) return execution
    return { ...execution, partialResult: update.partialResult }
  })
}

/** Picks out a validated tool result from a toolResult message, or returns null. */
export function toolResultInMessage(message: JsonObject): ToolResult | null {
  if (message.role !== 'toolResult' || typeof message.toolCallId !== 'string' || typeof message.toolName !== 'string') return null
  return {
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content: message.content,
    isError: message.isError === true,
    details: message.details,
  }
}

export function isToolCallPending(result: ToolResult | undefined): boolean {
  return result === undefined
}

/** Flattens arbitrary tool output into a single string, handling nested content arrays. */
export function toolContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (isObject(content) && 'content' in content) return toolContentText(content.content)
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => isObject(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n')
}

/** Extracts valid replacements provided to the edit tool. */
export function toolEditChanges(args: unknown): ToolEditChange[] {
  if (!isObject(args) || !Array.isArray(args.edits)) return []
  return args.edits.flatMap((edit) => isObject(edit) && typeof edit.oldText === 'string' && typeof edit.newText === 'string'
    ? [{ oldText: edit.oldText, newText: edit.newText }]
    : [])
}

export interface EditDiffLine {
  content: string
  kind: 'added' | 'context' | 'removed'
  lineNumber: number | null
}

export interface IntraLineSegment {
  text: string
  kind: 'added' | 'removed' | 'shared'
  highlighted?: boolean
}

/** Computes word-level diff segments with the same algorithm as Pi's edit renderer. */
export function intraLineDiff(oldText: string, newText: string): IntraLineSegment[] {
  const segments: IntraLineSegment[] = []
  let isFirstRemoved = true
  let isFirstAdded = true

  for (const part of diffWords(oldText, newText)) {
    const kind: IntraLineSegment['kind'] = part.removed ? 'removed' : part.added ? 'added' : 'shared'
    if (kind === 'shared') {
      segments.push({ text: part.value, kind })
      continue
    }

    const isFirst = kind === 'removed' ? isFirstRemoved : isFirstAdded
    if (kind === 'removed') isFirstRemoved = false
    else isFirstAdded = false
    if (!isFirst) {
      segments.push({ text: part.value, kind })
      continue
    }

    const leadingWhitespace = part.value.match(/^\s*/)?.[0] ?? ''
    if (leadingWhitespace) segments.push({ text: leadingWhitespace, kind, highlighted: false })
    const text = part.value.slice(leadingWhitespace.length)
    if (text) segments.push({ text, kind })
  }

  return segments
}

/** Turns Pi's display-oriented edit diff into colorable lines with source and destination line numbers. */
export function parseEditDiff(diff: string): EditDiffLine[] {
  return diff.split('\n').map((line) => {
    const match = line.match(/^([+\-\s])(\s*\d*)\s(.*)$/)
    if (match) {
      const lineNumber = match[2].trim()
      const kind = match[1] === '+' ? 'added' : match[1] === '-' ? 'removed' : 'context' as const
      return { content: match[3], kind, lineNumber: lineNumber ? parseInt(lineNumber, 10) : null }
    }
    return { content: line, kind: 'context', lineNumber: null }
  })
}

export type EditDiffDisplayLine = EditDiffLine & { segments?: IntraLineSegment[] }

/** Prepares Pi edit diff lines, limiting word highlights to single-line replacements. */
export function editDiffDisplayLines(diffLines: EditDiffLine[]): EditDiffDisplayLine[] {
  const lines = diffLines.map((line) => ({ ...line, content: line.content.replace(/\t/g, '   ') }))
  const displayLines: EditDiffDisplayLine[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.kind !== 'removed') {
      displayLines.push(line)
      index++
      continue
    }

    const removedLines: EditDiffLine[] = []
    while (index < lines.length && lines[index].kind === 'removed') removedLines.push(lines[index++])
    const addedLines: EditDiffLine[] = []
    while (index < lines.length && lines[index].kind === 'added') addedLines.push(lines[index++])

    if (removedLines.length === 1 && addedLines.length === 1) {
      const segments = intraLineDiff(removedLines[0].content, addedLines[0].content)
      displayLines.push({ ...removedLines[0], segments: segments.filter((segment) => segment.kind !== 'added') })
      displayLines.push({ ...addedLines[0], segments: segments.filter((segment) => segment.kind !== 'removed') })
      continue
    }

    displayLines.push(...removedLines, ...addedLines)
  }

  return displayLines
}

export function formatToolData(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? String(value) } catch { return String(value) }
}

export function toolDataLength(value: unknown): number {
  try { return (JSON.stringify(value) ?? String(value)).length } catch { return String(value).length }
}

export function formatToolCallTooltip(title: string, inputLength: number, outputLength?: number): string {
  return `${title}\nCall: ${inputLength} characters${outputLength === undefined ? '' : ` · Result: ${outputLength} characters`}`
}

/** Limits output to its first lines while reserving an indicator for the remaining content. */
export function toolTextPreview(text: string, maxLines = 4): { text: string; remainingLineCount: number } {
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  const remainingLineCount = Math.max(0, lines.length - maxLines)
  if (remainingLineCount === 0) return { text, remainingLineCount }
  return { text: `${lines.slice(0, maxLines).join('\n')}…`, remainingLineCount }
}

/** Builds a file:// URL compatible with POSIX paths, Windows paths, and WSL shares. */
export function fileUrl(path: string): string {
  const normalizedPath = path.replaceAll('\\', '/')
  if (normalizedPath.startsWith('//')) return `file:${encodeURI(normalizedPath)}`
  return `file://${encodeURI(normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`)}`
}

export function toolCallPresentation(call: ToolCall, repositoryRoot?: string | null): ToolCallPresentation {
  return toolCallPresentations[call.name]?.(call.args, repositoryRoot) ?? {}
}

/** Returns the target path for tools that manipulate a file directly. */
export function toolFilePath(args: unknown): string | null {
  return isObject(args) && typeof args.path === 'string' && args.path.length > 0 ? args.path : null
}

/** Returns the starting line number for read tool content display (offset or 1). */
export function readStartingLineNumber(args: unknown): number {
  if (!isObject(args)) return 1
  return positiveInteger(args.offset) ?? 1
}

/** Determines file rendering from its path extension. */
export function readContentDisplay(args: unknown): ReadContentDisplay {
  const path = toolFilePath(args)
  if (!path) return { kind: 'text' }

  const extension = path.match(/\.([^./]+)$/)?.[1]?.toLowerCase()
  if (extension === 'md' || extension === 'markdown') return { kind: 'markdown' }
  if (extension === 'htm' || extension === 'html') return { kind: 'html' }
  if (extension === 'svg') return { kind: 'svg' }

  const language = extension ? languageByExtension[extension] : undefined
  return language ? { kind: 'code', language } : { kind: 'text' }
}

const languageByExtension: Record<string, string> = {
  bash: 'bash',
  cjs: 'javascript',
  cs: 'csharp',
  css: 'css',
  fish: 'bash',
  htm: 'markup',
  html: 'markup',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  mjs: 'javascript',
  sh: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  zsh: 'bash',
}

function toolCallFromValue(value: unknown): ToolCall | null {
  if (!isObject(value) || value.type !== 'toolCall' || typeof value.id !== 'string' || typeof value.name !== 'string') return null
  return { id: value.id, name: value.name, args: value.arguments }
}

function toolCallFromPartial(value: unknown, contentIndex: number): ToolCall | null {
  if (!isObject(value) || !Array.isArray(value.content)) return null
  return toolCallFromValue(value.content[contentIndex])
}
