import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tooltip } from '../../components/Tooltip.tsx'
import { getWorkspaceFile, getWorkspaceFilePath } from '../../api.ts'
import { fileContextDraft } from './context-session.ts'
import { canHighlightFile } from './file-preview.ts'
import {
  editDiffDisplayLines,
  formatToolCallTooltip,
  formatToolData,
  intraLineDiff,
  parseEditDiff,
  readContentDisplay,
  readStartingLineNumber,
  toolCallPresentation,
  toolDataLength,
  toolEditChanges,
  toolFilePath,
  toolTextPreview,
  fileUrl,
  type EditDiffLine,
} from './tool-presentation.ts'
import { toolContentText } from './tool-protocol.ts'

const LazyCodeHighlighter = lazy(() => import('./CodeHighlighter'))

/** Reports whether an element is in the viewport (plus a vertical margin). */
function useInView(ref: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setInView(entry.isIntersecting)
      },
      { rootMargin: '800px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled, ref])
  return inView
}

export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
}

/** Opens a session with a context draft without sending it immediately. */
export function ContextSessionButton(
  { onClick, onError }: { onClick: () => Promise<void>; onError?: (cause: unknown) => void },
) {
  const [busy, setBusy] = useState(false)

  async function activate(): Promise<void> {
    setBusy(true)
    try {
      await onClick()
    } catch (cause) {
      onError?.(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tooltip label='Continue in a new session'>
      <button
        aria-label='Continue in a new session'
        className='context-session-button'
        disabled={busy}
        onClick={() => void activate()}
        type='button'
      >
        <svg aria-hidden='true' viewBox='0 0 16 16'>
          <path
            d='M8 3.5v9M3.5 8h9'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeWidth='1.5'
          />
        </svg>
      </button>
    </Tooltip>
  )
}

interface ToolCallCardProps {
  animateLiveChanges?: boolean
  args: unknown
  darkMode: boolean
  hasResult: boolean
  id: string
  interrupted?: boolean
  name: string
  onError: (cause: unknown) => void
  onStartSession: (draft: string) => Promise<void>
  repositoryRoot?: string | null
  partialResultContent?: unknown
  resultContent?: unknown
  resultDetails?: unknown
  resultError?: boolean
  streaming?: boolean
  targeted?: boolean
  workspacePath: string
}

/** Displays the official card whose full result replaces the preview when expanded. */
export const ToolCallCard = memo(function ToolCallCard({
  animateLiveChanges = false,
  args,
  darkMode,
  hasResult,
  id,
  interrupted = false,
  name,
  onError,
  onStartSession,
  partialResultContent,
  repositoryRoot,
  resultContent,
  resultDetails,
  resultError,
  streaming = false,
  targeted = false,
  workspacePath,
}: ToolCallCardProps) {
  const pending = !hasResult
  const active = pending && !interrupted
  const filePath = name === 'read' || name === 'write' ? toolFilePath(args) : null
  const display = filePath ? readContentDisplay({ path: filePath }) : { kind: 'text' as const }
  const htmlFile = display.kind === 'html'
  const [expanded, setExpanded] = useState(name === 'edit')
  const [partialOutputExpanded, setPartialOutputExpanded] = useState(false)
  const [writtenContent, setWrittenContent] = useState<string>()
  const [writtenContentError, setWrittenContentError] = useState<string>()
  const [loadingWrittenContent, setLoadingWrittenContent] = useState(false)
  const [htmlOpenError, setHtmlOpenError] = useState<string>()
  const [codeRendered, setCodeRendered] = useState(false)
  const [argsExpanded, setArgsExpanded] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const input = formatToolData(args)
  const inputLength = toolDataLength(args)
  const maxPreviewChars = 400
  const output = hasResult ? toolContentText(resultContent) : ''
  const partialOutput = !hasResult && partialResultContent !== undefined
    ? toolContentText(partialResultContent)
    : ''
  const partialOutputLength = partialOutput.length
  const partialOutputTruncated = partialOutputLength > maxPreviewChars
  const partialOutputPreviewText = partialOutputTruncated
    ? `${partialOutput.slice(0, maxPreviewChars)}…`
    : partialOutput
  const outputLength = output.length
  const displayedOutput = output || 'No output.'
  const presentation = toolCallPresentation({ id, name, args }, repositoryRoot)
  const tooltip = formatToolCallTooltip(
    presentation.headerDetail?.title ?? input,
    inputLength,
    hasResult ? outputLength : undefined,
  )
  const resolvedSizeLabel = `Input: ${inputLength} characters. Output: ${outputLength} characters.`
  const content = htmlOpenError
    ?? (!resultError ? undefined : writtenContentError)
    ?? (name === 'write' && writtenContent === undefined && loadingWrittenContent
      ? 'Loading file…'
      : name === 'write'
      ? writtenContent ?? displayedOutput
      : displayedOutput)
  const hasCodePreview = display.kind === 'code' && hasResult && !expanded
    && canHighlightFile(content)
  const isNearViewport = useInView(cardRef, hasCodePreview)
  const contentError = resultError
  const preview = toolTextPreview(content)
  const streamingArgs = streaming || interrupted ? input : undefined
  const streamingTruncated = Boolean(streamingArgs && streamingArgs.length > maxPreviewChars)
  const streamingPreviewText = streamingArgs && streamingArgs.length > maxPreviewChars
    ? `${streamingArgs.slice(0, maxPreviewChars)}…`
    : streamingArgs
  const renderingCode = display.kind === 'code' && canHighlightFile(content) && expanded
    && !loadingWrittenContent && !writtenContentError && !codeRendered

  useEffect(() => {
    if (name !== 'write' || !filePath || !hasResult || resultError) return
    let cancelled = false
    setWrittenContent(undefined)
    setWrittenContentError(undefined)
    setLoadingWrittenContent(true)
    void getWorkspaceFile(workspacePath, filePath)
      .then((file) => {
        if (!cancelled) setWrittenContent(file.content)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setWrittenContentError(messageOf(cause))
      })
      .finally(() => {
        if (!cancelled) setLoadingWrittenContent(false)
      })
    return () => {
      cancelled = true
    }
  }, [filePath, hasResult, name, resultError, workspacePath])

  useEffect(() => {
    if (
      !expanded || display.kind !== 'code' || loadingWrittenContent || writtenContentError
      || codeRendered
    ) return
    const timeout = window.setTimeout(() => setCodeRendered(true), 0)
    return () => window.clearTimeout(timeout)
  }, [codeRendered, display.kind, expanded, loadingWrittenContent, writtenContentError])

  /** Opens HTML reads in the browser and expands other output in the history. */
  const activate = () => {
    if (filePath && htmlFile) {
      const tab = window.open('', '_blank')
      if (tab) tab.opener = null
      setHtmlOpenError(undefined)
      void getWorkspaceFilePath(workspacePath, filePath)
        .then(({ path }) => {
          if (tab) tab.location.href = fileUrl(path)
        })
        .catch((cause: unknown) => {
          tab?.close()
          setHtmlOpenError(messageOf(cause))
        })
      return
    }
    setExpanded((isExpanded) => !isExpanded)
  }

  const hasBody = streaming || interrupted || hasResult || Boolean(partialOutput)

  return (
    <article
      className={`tool-call${animateLiveChanges && streaming ? ' entering' : ''}${
        contentError ? ' error' : ''
      }${interrupted ? ' interrupted' : ''}${targeted ? ' conversation-target' : ''}`}
      data-tool-call-id={id}
      ref={cardRef}
    >
      <Tooltip label={tooltip}>
        <button
          aria-expanded={htmlFile ? undefined : hasResult ? expanded : undefined}
          className='tool-call-heading'
          disabled={!hasResult}
          onClick={activate}
          type='button'
        >
          <span aria-hidden='true'>⌘</span>
          <span>
            <strong aria-label={tooltip}>{name || 'Tool'}</strong>
          </span>
          {presentation.headerDetail && (
            <span className='tool-call-command'>
              <code aria-label={`Full command: ${presentation.headerDetail.title}`}>
                {presentation.headerDetail.text}
              </code>
            </span>
          )}
          {presentation.headerDetail?.suffix && (
            <span className='tool-call-range'>
              <code aria-label={`Read range: ${presentation.headerDetail.suffix}`}>
                {presentation.headerDetail.suffix}
              </code>
            </span>
          )}
          <small
            aria-label={hasResult && !contentError
              ? resolvedSizeLabel
              : partialOutput
              ? `Output: ${partialOutputLength} characters so far`
              : undefined}
          >
            {active && presentation.pendingDetail && `${presentation.pendingDetail} · `}
            {hasResult
              ? contentError
                ? 'Failed'
                : <span aria-hidden='true'>↘ {inputLength} car. · ↗ {outputLength} car.</span>
              : interrupted
              ? 'Generation interrupted'
              : streaming
              ? 'Generating…'
              : partialOutput
              ? <span aria-hidden='true'>↗ {partialOutputLength} car.</span>
              : 'In progress…'}
            {active && (
              <span
                aria-label={streaming ? 'Arguments are being generated' : 'Tool in progress'}
                className='spinner tool-call-spinner'
                role='status'
              />
            )}
          </small>
        </button>
      </Tooltip>
      {filePath && (name === 'read' || name === 'write') && hasResult && (
        <ContextSessionButton
          onClick={async () => {
            const { absolutePath } = await getWorkspaceFilePath(workspacePath, filePath)
            await onStartSession(fileContextDraft(absolutePath))
          }}
          onError={onError}
        />
      )}
      <div className={`tool-call-body${hasBody ? ' visible' : ''}`}>
        <div>
          {(streaming || interrupted) && (
            <>
              {argsExpanded
                ? (
                  <button
                    aria-expanded={true}
                    className='tool-call-raw-args'
                    onClick={() => setArgsExpanded(false)}
                    type='button'
                  >
                    {streamingArgs || 'Waiting for arguments…'}
                  </button>
                )
                : (
                  <button
                    aria-expanded={false}
                    className='tool-call-preview'
                    onClick={() => setArgsExpanded(true)}
                    type='button'
                  >
                    <pre>{streamingPreviewText ?? 'Waiting for arguments…'}</pre>
                    {streamingTruncated && (
                      <span>Click to view full arguments ({streamingArgs?.length ?? 0} chars)</span>
                    )}
                  </button>
                )}
            </>
          )}
          {active && partialOutput && (
            <>
              {partialOutputExpanded
                ? (
                  <button
                    aria-expanded={true}
                    className='tool-call-raw-args'
                    onClick={() => setPartialOutputExpanded(false)}
                    type='button'
                  >
                    {partialOutput || 'Waiting for output…'}
                  </button>
                )
                : (
                  <button
                    aria-expanded={false}
                    className='tool-call-preview'
                    onClick={() => setPartialOutputExpanded(true)}
                    type='button'
                  >
                    <pre>{partialOutputPreviewText || 'Waiting for output…'}</pre>
                    {partialOutputTruncated && (
                      <span>Click to view full output ({partialOutputLength} chars)</span>
                    )}
                  </button>
                )}
            </>
          )}
          {hasResult && (
            <div className={animateLiveChanges ? 'tool-call-result entering' : 'tool-call-result'}>
              {expanded && !htmlFile
                ? (
                  <ToolCallContent
                    call={{ name, args }}
                    content={content}
                    darkMode={darkMode}
                    onCollapse={() => setExpanded(false)}
                    renderingCode={renderingCode || loadingWrittenContent}
                    resultDetails={resultDetails}
                    showEditDiff={!contentError}
                  />
                )
                : (
                  <ToolCallPreview
                    call={{ name, args }}
                    content={display.kind === 'svg'
                      ? content
                      : preview
                        .text}
                    darkMode={darkMode}
                    htmlFile={htmlFile}
                    isNearViewport={isNearViewport}
                    onClick={activate}
                    remainingLineCount={preview
                      .remainingLineCount}
                  />
                )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
})

const lineNumberStyle: React.CSSProperties = {
  minWidth: '2.5em',
  paddingRight: '1em',
  textAlign: 'right',
  userSelect: 'none',
  opacity: 0.5,
}

/** Renders preformatted content with line numbers starting at an arbitrary offset. */
function NumberedPre({ content, startLine }: { content: string; startLine: number }) {
  const lines = content.split('\n')
  const displayLines = content.endsWith('\n') ? lines.slice(0, -1) : lines
  const width = String(startLine + displayLines.length - 1).length
  return (
    <pre className='tool-call-numbered-pre'>
    {displayLines.map((line, i) => {
      const num = startLine + i
      return <div key={i}><span>{String(num).padStart(width)}</span>{line}</div>
    })}
    </pre>
  )
}

/** Displays a clickable preview for code files and resolved SVGs. */
function ToolCallPreview({
  call,
  content,
  darkMode,
  htmlFile,
  isNearViewport,
  onClick,
  remainingLineCount,
}: {
  call: { name: string; args: unknown }
  content: string
  darkMode: boolean
  htmlFile: boolean
  isNearViewport: boolean
  onClick: () => void
  remainingLineCount: number
}) {
  const display = call.name === 'read' || call.name === 'write'
    ? readContentDisplay(call.args)
    : { kind: 'text' as const }
  const remainingLabel = display.kind === 'svg'
    ? 'Click to view full code'
    : `Click to view ${remainingLineCount} more ${remainingLineCount === 1 ? 'line' : 'lines'}`
  const highlightedCode = display.kind === 'code' && canHighlightFile(content)
  const svgPreview = display.kind === 'svg' && content.trim().length > 0
  const filePath = toolFilePath(call.args)
  const isRead = call.name === 'read'
  const startLine = isRead ? readStartingLineNumber(call.args) : 1
  const plainPreview = isRead
    ? <NumberedPre content={content} startLine={startLine} />
    : <pre>{content}</pre>

  return (
    <button className='tool-call-preview' onClick={onClick} type='button'>
      {svgPreview
        ? (
          <img
            alt={`SVG preview of ${filePath ?? 'file'}`}
            className='tool-call-svg-preview'
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`}
          />
        )
        : highlightedCode && isNearViewport
        ? (
          <Suspense fallback={plainPreview}>
            <LazyCodeHighlighter
              className='tool-call-syntax'
              customStyle={{ background: 'transparent', margin: 0, padding: '9px 10px 4px' }}
              language={display.language}
              PreTag='div'
              showLineNumbers={isRead}
              startingLineNumber={isRead ? startLine : undefined}
              lineNumberStyle={isRead ? lineNumberStyle : undefined}
              darkMode={darkMode}
              wrapLongLines
            >
              {content}
            </LazyCodeHighlighter>
          </Suspense>
        )
        : plainPreview}
      {remainingLineCount > 0 && <span>{remainingLabel}</span>}
      {htmlFile && <span>Click to open in browser</span>}
    </button>
  )
}

/** Displays the full result in its appropriate format instead of the preview. */
function ToolCallContent({
  call,
  content,
  darkMode,
  onCollapse,
  renderingCode,
  resultDetails,
  showEditDiff,
}: {
  call: { name: string; args: unknown }
  content: string
  darkMode: boolean
  onCollapse: () => void
  renderingCode: boolean
  resultDetails?: unknown
  showEditDiff: boolean
}) {
  if (renderingCode)
    return (
      <section className='tool-call-content tool-call-loading' role='status' onClick={onCollapse}>
        <span aria-hidden='true' className='spinner' />Highlighting file…
      </section>
    )

  const diffString = extractEditDiffString(resultDetails)
  const diffLines = diffString ? parseEditDiff(diffString) : []
  const changes = showEditDiff && call.name === 'edit' ? toolEditChanges(call.args) : []
  if (diffLines.length > 0 || changes.length > 0)
    return <ToolCallEditDiff changes={changes} diffLines={diffLines} onCollapse={onCollapse} />

  const display = call.name === 'read' || call.name === 'write'
    ? readContentDisplay(call.args)
    : { kind: 'text' as const }
  const isRead = call.name === 'read'
  const startLine = isRead ? readStartingLineNumber(call.args) : 1
  if (display.kind === 'markdown')
    return (
      <section className='tool-call-content tool-call-markdown' onClick={onCollapse}>
        <Markdown>{content}</Markdown>
      </section>
    )
  if (display.kind === 'code' && canHighlightFile(content))
    return (
      <section className='tool-call-content' onClick={onCollapse}>
        <Suspense
          fallback={isRead
            ? <NumberedPre content={content} startLine={startLine} />
            : <pre>{content}</pre>}
        >
          <LazyCodeHighlighter
            className='tool-call-syntax'
            customStyle={{ background: 'transparent', margin: 0, padding: '9px 10px' }}
            language={display.language}
            PreTag='div'
            showLineNumbers={isRead}
            startingLineNumber={isRead ? startLine : undefined}
            lineNumberStyle={isRead ? lineNumberStyle : undefined}
            darkMode={darkMode}
            wrapLongLines
          >
            {content}
          </LazyCodeHighlighter>
        </Suspense>
      </section>
    )
  if (display.kind === 'code')
    return (
      <section className='tool-call-content' onClick={onCollapse}>
        <p className='tool-call-notice'>Highlighting disabled beyond 50,000 characters.</p>
        {isRead ? <NumberedPre content={content} startLine={startLine} /> : <pre>{content}</pre>}
      </section>
    )
  return (
    <section className='tool-call-content' onClick={onCollapse}>
      {isRead ? <NumberedPre content={content} startLine={startLine} /> : <pre>{content}</pre>}
    </section>
  )
}

/** Extracts the display-oriented diff string from Pi result details when available. */
function extractEditDiffString(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined
  const d = details as Record<string, unknown>
  return typeof d.diff === 'string' ? d.diff : undefined
}

/** Renders segments with intra-line highlights for changed words. */
function DiffLineContent(
  { content, segments }: {
    content: string
    segments?: { text: string; kind: 'added' | 'removed' | 'shared'; highlighted?: boolean }[]
  },
) {
  if (!segments || segments.length === 0) return <pre>{content}</pre>
  return (
    <pre>{segments.map((seg, i) => <span className={seg.highlighted === false ? undefined : `diff-seg-${seg.kind}`} key={i}>{seg.text}</span>)}</pre>
  )
}

/** Displays each replacement from an edit call, preferring Pi's line-numbered diff when available. */
function ToolCallEditDiff(
  { changes, diffLines, onCollapse }: {
    changes: ReturnType<typeof toolEditChanges>
    diffLines: EditDiffLine[]
    onCollapse: () => void
  },
) {
  if (diffLines.length > 0) {
    const displayLines = editDiffDisplayLines(diffLines)

    return (
      <section className='tool-call-content tool-call-edit-diff' onClick={onCollapse}>
        <section className='tool-call-edit-change'>
          {displayLines.map((line, j) => {
            const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '
            return (
              <div className={`tool-call-edit-line ${line.kind}`} key={j}>
                <span>{line.lineNumber ?? ''}</span>
                <i aria-hidden='true'>{sign}</i>
                <DiffLineContent content={line.content} segments={line.segments} />
              </div>
            )
          })}
        </section>
      </section>
    )
  }

  return (
    <section className='tool-call-content tool-call-edit-diff' onClick={onCollapse}>
      {changes.map((change, index) => {
        const segments = intraLineDiff(change.oldText, change.newText)
        return (
          <section className='tool-call-edit-change' key={index}>
            <h4>Change {index + 1}</h4>
            <div className='tool-call-edit-line removed'>
              <span />
              <i aria-hidden='true'>−</i>
              <pre>{segments.filter(s => s.kind !== 'added').map((seg, si) => <span className={seg.highlighted === false ? undefined : `diff-seg-${seg.kind}`} key={si}>{seg.text}</span>)}</pre>
            </div>
            <div className='tool-call-edit-line added'>
              <span />
              <i aria-hidden='true'>+</i>
              <pre>{segments.filter(s => s.kind !== 'removed').map((seg, si) => <span className={seg.highlighted === false ? undefined : `diff-seg-${seg.kind}`} key={si}>{seg.text}</span>)}</pre>
            </div>
          </section>
        )
      })}
    </section>
  )
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
