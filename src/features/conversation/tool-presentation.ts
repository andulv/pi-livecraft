import { diffWords } from 'diff'
import { isObject } from '../../../shared/is-object.ts'
import { toolCallPresentations } from './tool-call-presentations/index.ts'
import { positiveInteger, type ToolCallPresentation } from './tool-call-presentations/shared.ts'
import type { ToolCall } from './tool-protocol.ts'

export { truncateToolText } from './tool-call-presentations/shared.ts'

export interface ReadContentDisplay {
  kind: 'code' | 'csv' | 'html' | 'markdown' | 'svg' | 'text'
  language?: string
}

export interface ToolEditChange {
  oldText: string
  newText: string
}

/** Extracts valid replacements provided to the edit tool. */
export function toolEditChanges(args: unknown): ToolEditChange[] {
  if (!isObject(args) || !Array.isArray(args.edits)) return []
  return args.edits.flatMap((edit) =>
    isObject(edit) && typeof edit.oldText === 'string' && typeof edit.newText === 'string'
      ? [{ oldText: edit.oldText, newText: edit.newText }]
      : []
  )
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
    const kind: IntraLineSegment['kind'] = part.removed
      ? 'removed'
      : part.added
      ? 'added'
      : 'shared'
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
    while (index < lines.length && lines[index].kind === 'removed') {
      removedLines.push(lines[index++])
    }
    const addedLines: EditDiffLine[] = []
    while (index < lines.length && lines[index].kind === 'added') addedLines.push(lines[index++])

    if (removedLines.length === 1 && addedLines.length === 1) {
      const segments = intraLineDiff(removedLines[0].content, addedLines[0].content)
      displayLines.push({
        ...removedLines[0],
        segments: segments.filter((segment) => segment.kind !== 'added'),
      })
      displayLines.push({
        ...addedLines[0],
        segments: segments.filter((segment) => segment.kind !== 'removed'),
      })
      continue
    }

    displayLines.push(...removedLines, ...addedLines)
  }

  return displayLines
}

export function formatToolData(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

export function toolDataLength(value: unknown): number {
  try {
    return (JSON.stringify(value) ?? String(value)).length
  } catch {
    return String(value).length
  }
}

export function formatToolCallTooltip(
  title: string,
  inputLength: number,
  outputLength?: number,
): string {
  return `${title}\nCall: ${inputLength} characters${
    outputLength === undefined ? '' : ` · Result: ${outputLength} characters`
  }`
}

/** Limits output to its first lines while reserving an indicator for the remaining content. */
export function toolTextPreview(
  text: string,
  maxLines = 4,
): { text: string; remainingLineCount: number } {
  const contentEnd = text.endsWith('\n') ? text.length - 1 : text.length
  let lineCount = 1
  let previewEnd = maxLines > 0 ? contentEnd : 0
  let searchFrom = 0
  while (searchFrom < contentEnd) {
    const newline = text.indexOf('\n', searchFrom)
    if (newline < 0 || newline >= contentEnd) break
    lineCount += 1
    if (lineCount === maxLines + 1) previewEnd = newline
    searchFrom = newline + 1
  }
  const remainingLineCount = Math.max(0, lineCount - maxLines)
  if (remainingLineCount === 0) return { text, remainingLineCount }
  return { text: `${text.slice(0, previewEnd)}…`, remainingLineCount }
}

/** Builds a file:// URL compatible with POSIX paths, Windows paths, and WSL shares. */
export function fileUrl(path: string): string {
  const normalizedPath = path.replaceAll('\\', '/')
  if (normalizedPath.startsWith('//')) return `file:${encodeURI(normalizedPath)}`
  return `file://${
    encodeURI(normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`)
  }`
}

export function toolCallPresentation(
  call: ToolCall,
  repositoryRoot?: string | null,
  rawArguments?: string,
): ToolCallPresentation {
  const presenter = toolCallPresentations[call.name]
  if (!presenter) return {}

  const args = call.name === 'edit' || call.name === 'read' || call.name === 'write'
    ? fileToolArguments(call.args, rawArguments)
    : call.args
  return presenter(args, repositoryRoot)
}

/** Adds a streamed file path to presentation without changing final tool arguments. */
function fileToolArguments(args: unknown, rawArguments?: string): unknown {
  if (!rawArguments || toolFilePath(args)) return args
  // ponytail: only streamed string paths matter; use an incremental parser if more fields need display.
  const match = rawArguments.match(/(?:^|[,{])\s*"path"\s*:\s*"((?:\\.|[^"\\])*)/)
  if (!match) return args

  try {
    const path = JSON.parse(`"${match[1]}"`)
    return typeof path === 'string' ? (isObject(args) ? { ...args, path } : { path }) : args
  } catch {
    return args
  }
}

/** Infers a built-in tool name from complete or partial argument keys. */
export function provisionalToolName(args: unknown, rawArguments?: string): string | undefined {
  const keys = new Set(isObject(args) ? Object.keys(args) : [])
  if (rawArguments) {
    for (const key of partialJsonObjectKeys(rawArguments)) keys.add(key)
  }
  if (keys.has('edits') || (keys.has('oldText') && keys.has('newText'))) return 'edit'
  if (keys.has('command')) return 'bash'
  if (keys.has('path') && keys.has('content')) return 'write'
  return undefined
}

// ponytail: schema-shape inference can mislabel custom tools; use streamed names if RPC exposes them.
function partialJsonObjectKeys(value: string): string[] {
  const keys: string[] = []
  let depth = 0
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char === '"') {
      const start = index
      let escaped = false
      for (index += 1; index < value.length; index++) {
        const next = value[index]
        if (escaped) escaped = false
        else if (next === '\\') escaped = true
        else if (next === '"') break
      }
      if (depth === 1 && value[index] === '"' && /^\s*:/.test(value.slice(index + 1))) {
        try {
          const key = JSON.parse(value.slice(start, index + 1))
          if (typeof key === 'string') keys.push(key)
        } catch {
          // Ignore malformed or incomplete partial JSON.
        }
      }
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') depth = Math.max(0, depth - 1)
  }
  return keys
}

/** Returns the target path for tools that manipulate a file directly. */
export function toolFilePath(args: unknown): string | null {
  return isObject(args) && typeof args.path === 'string' && args.path.length > 0 ? args.path : null
}

/** Returns the text content sent to Pi for the write tool, or null when unavailable or not a write. */
export function toolWriteContent(args: unknown): string | null {
  return isObject(args) && typeof args.content === 'string' && args.content.length > 0
    ? args.content
    : null
}

/** Removes executable HTML hooks before rendering a sandboxed preview. */
export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>(?:[\s\S]*?<\/script\s*>|[\s\S]*)/gi, '')
    .replace(/<script\b[^>]*\/\s*>/gi, '')
    .replace(/<\/script\s*>/gi, '')
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s+(?:href|src|action|formaction|poster|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi,
      '',
    )
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
  if (extension === 'csv') return { kind: 'csv' }
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
