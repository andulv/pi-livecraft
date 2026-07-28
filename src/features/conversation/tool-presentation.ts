import { diffWords } from 'diff'
import { isObject } from '../../../shared/is-object.ts'
import { toolCallPresentations } from './tool-call-presentations/index.ts'
import { positiveInteger, type ToolCallPresentation } from './tool-call-presentations/shared.ts'
import type { ToolCall } from './tool-protocol.ts'

export { truncateToolText } from './tool-call-presentations/shared.ts'

export interface ReadContentDisplay {
  kind: 'code' | 'html' | 'markdown' | 'svg' | 'text'
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
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  const remainingLineCount = Math.max(0, lines.length - maxLines)
  if (remainingLineCount === 0) return { text, remainingLineCount }
  return { text: `${lines.slice(0, maxLines).join('\n')}…`, remainingLineCount }
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
): ToolCallPresentation {
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
