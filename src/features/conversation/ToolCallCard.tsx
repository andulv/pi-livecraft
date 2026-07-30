import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tooltip } from '../../components/Tooltip.tsx'
import { CopyButton } from './CopyButton.tsx'
import { canHighlightFile } from './file-preview.ts'
import { parseMarkdownFrontmatter } from './markdown-frontmatter.ts'
import { csvSourcePreview, parseCsvPreview, type CsvPreview } from './csv-preview.ts'
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
  toolWriteContent,
  stripScripts,
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

export function Markdown(
  { children, renderFrontmatter = false }: { children: string; renderFrontmatter?: boolean },
) {
  const frontmatter = renderFrontmatter ? parseMarkdownFrontmatter(children) : null
  const body = frontmatter?.body ?? children

  return (
    <>
      {frontmatter && frontmatter.entries.length > 0 && (
        <table className='tool-call-frontmatter'>
          <thead>
            <tr>
              <th>Property</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {frontmatter.entries.map(({ key, value }) => (
              <tr key={key}>
                <th scope='row'>{key}</th>
                <td>
                  <code className='tool-call-frontmatter-value'>{value}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </>
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
  repositoryRoot?: string | null
  partialResultContent?: unknown
  resultContent?: unknown
  resultDetails?: unknown
  resultError?: boolean
  streaming?: boolean
  targeted?: boolean
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
  partialResultContent,
  repositoryRoot,
  resultContent,
  resultDetails,
  resultError,
  streaming = false,
  targeted = false,
}: ToolCallCardProps) {
  const pending = !hasResult
  const active = pending && !interrupted
  const filePath = name === 'read' || name === 'write' ? toolFilePath(args) : null
  const display = filePath ? readContentDisplay({ path: filePath }) : { kind: 'text' as const }
  const [expanded, setExpanded] = useState(name === 'edit')
  const [partialOutputExpanded, setPartialOutputExpanded] = useState(false)
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
  const writeContent = name === 'write' ? toolWriteContent(args) : null
  const content = name === 'write' && !resultError && writeContent ? writeContent : displayedOutput
  const isRenderable = display.kind === 'csv' || display.kind === 'markdown'
    || display.kind === 'html' || display.kind === 'svg'
  const hasRenderedPreview = isRenderable && hasResult && !expanded && !resultError
  const hasCodePreview = display.kind === 'code' && hasResult && !expanded
    && canHighlightFile(content)
  const isNearViewport = useInView(cardRef, hasCodePreview || hasRenderedPreview)
  const contentError = resultError
  const preview = display.kind === 'csv'
    ? {
      text: content.length > maxPreviewChars
        ? `${content.slice(0, maxPreviewChars)}…`
        : content,
      remainingLineCount: 0,
    }
    : toolTextPreview(content)
  const streamingArgs = streaming || interrupted ? input : undefined
  const streamingTruncated = Boolean(streamingArgs && streamingArgs.length > maxPreviewChars)
  const streamingPreviewText = streamingArgs && streamingArgs.length > maxPreviewChars
    ? `${streamingArgs.slice(0, maxPreviewChars)}…`
    : streamingArgs
  const renderingCode = display.kind === 'code' && canHighlightFile(content) && expanded
    && !codeRendered

  useEffect(() => {
    if (!expanded || display.kind !== 'code' || codeRendered) return
    const timeout = window.setTimeout(() => setCodeRendered(true), 0)
    return () => window.clearTimeout(timeout)
  }, [codeRendered, display.kind, expanded])

  /** Expands or collapses the tool call output. */
  const activate = () => setExpanded((isExpanded) => !isExpanded)

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
          aria-expanded={hasResult ? expanded : undefined}
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
      <div className='conversation-actions tool-call-actions'>
        <CopyButton direction='input' label='Copy tool input' onError={onError} value={input} />
        {hasResult && (
          <CopyButton
            direction='output'
            label='Copy tool output'
            onError={onError}
            value={output}
          />
        )}
      </div>
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
              {expanded
                ? (
                  <ToolCallContent
                    call={{ name, args }}
                    content={content}
                    darkMode={darkMode}
                    onCollapse={() => setExpanded(false)}
                    renderingCode={renderingCode}
                    resultDetails={resultDetails}
                    showEditDiff={!contentError}
                  />
                )
                : (
                  <ToolCallPreview
                    call={{ name, args }}
                    content={display.kind === 'csv' || display
                          .kind === 'svg'
                        || display
                            .kind === 'html'
                        || display
                            .kind === 'markdown'
                      ? content
                      : preview
                        .text}
                    darkMode={darkMode}
                    isNearViewport={isNearViewport}
                    onClick={activate}
                    showHtmlPreview={!contentError}
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

/** Displays a clickable preview for CSV, code, HTML, resolved SVG, and Markdown files. */
function ToolCallPreview({
  call,
  content,
  darkMode,
  isNearViewport,
  onClick,
  remainingLineCount,
  showHtmlPreview,
}: {
  call: { name: string; args: unknown }
  content: string
  darkMode: boolean
  isNearViewport: boolean
  onClick: () => void
  remainingLineCount: number
  showHtmlPreview: boolean
}) {
  const display = call.name === 'read' || call.name === 'write'
    ? readContentDisplay(call.args)
    : { kind: 'text' as const }
  const isRenderable = display.kind === 'csv' || display.kind === 'markdown'
    || display.kind === 'html' || display.kind === 'svg'
  const remainingLabel = isRenderable
    ? 'View source'
    : `Click to view ${remainingLineCount} more ${remainingLineCount === 1 ? 'line' : 'lines'}`
  const showLabel = remainingLineCount > 0 || isRenderable
  const highlightedCode = display.kind === 'code' && canHighlightFile(content)
  const svgPreview = display.kind === 'svg' && content.trim().length > 0
  const htmlPreview = display.kind === 'html' && showHtmlPreview
  const markdownPreview = display.kind === 'markdown'
  const csvPreview = display.kind === 'csv'
  const parsedCsv = useMemo(
    () => csvPreview && isNearViewport ? parseCsvPreview(content) : null,
    [content, csvPreview, isNearViewport],
  )
  const filePath = toolFilePath(call.args)
  const isReadOrWrite = call.name === 'read' || call.name === 'write'
  const startLine = isReadOrWrite ? readStartingLineNumber(call.args) : 1
  const plainPreview = csvPreview
    ? <pre>{content.length > 400 ? `${content.slice(0, 400)}…` : content}</pre>
    : isReadOrWrite
    ? <NumberedPre content={content} startLine={startLine} />
    : <pre>{content}</pre>

  return (
    <button className='tool-call-preview' onClick={onClick} type='button'>
      {csvPreview
        ? isNearViewport && parsedCsv
          ? <CsvTable preview={parsedCsv} />
          : plainPreview
        : markdownPreview
        ? isNearViewport
          ? (
            <div className='tool-call-markdown-preview'>
              <Markdown renderFrontmatter>{content}</Markdown>
            </div>
          )
          : plainPreview
        : htmlPreview
        ? isNearViewport
          ? (
            <iframe
              className='tool-call-html-preview'
              sandbox=''
              srcDoc={stripScripts(content)}
              title={`HTML preview of ${filePath ?? 'file'}`}
            />
          )
          : plainPreview
        : svgPreview
        ? isNearViewport
          ? (
            <img
              alt={`SVG preview of ${filePath ?? 'file'}`}
              className='tool-call-svg-preview'
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`}
            />
          )
          : plainPreview
        : highlightedCode && isNearViewport
        ? (
          <Suspense fallback={plainPreview}>
            <LazyCodeHighlighter
              className='tool-call-syntax'
              customStyle={{ background: 'transparent', margin: 0, padding: '9px 10px 4px' }}
              language={display.language}
              PreTag='div'
              showLineNumbers={isReadOrWrite}
              startingLineNumber={isReadOrWrite ? startLine : undefined}
              lineNumberStyle={isReadOrWrite ? lineNumberStyle : undefined}
              darkMode={darkMode}
              wrapLongLines
            >
              {content}
            </LazyCodeHighlighter>
          </Suspense>
        )
        : plainPreview}
      {showLabel && <span>{remainingLabel}</span>}
    </button>
  )
}

/** Renders a bounded CSV table without materializing the complete file in the DOM. */
function CsvTable({ preview }: { preview: CsvPreview }) {
  const [header, ...body] = preview.rows
  if (!header) return <pre className='tool-call-csv-empty'>No CSV rows.</pre>

  return (
    <div className='tool-call-csv-preview'>
      <table aria-label='CSV preview'>
        <thead>
          <tr>
            {header.map((cell, index) => <th key={index} scope='col' title={cell}>{cell}</th>)}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, columnIndex) => <td key={columnIndex} title={cell}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {preview.truncated && (
        <p className='tool-call-csv-notice'>
          Preview limited for performance.
        </p>
      )}
    </div>
  )
}

/** Displays a bounded CSV source while preserving the complete value for copying. */
function CsvSourceContent({ content, onCollapse }: { content: string; onCollapse: () => void }) {
  const source = csvSourcePreview(content)
  return (
    <section className='tool-call-content tool-call-csv-source' onClick={onCollapse}>
      {source.truncated && (
        <p className='tool-call-notice'>Source preview limited to 20,000 characters.</p>
      )}
      <pre>{source.text}</pre>
    </section>
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

  const rawContentDisplay = call.name === 'read' || call.name === 'write'
    ? readContentDisplay(call.args)
    : { kind: 'text' as const }
  const display = rawContentDisplay.kind === 'html' || rawContentDisplay.kind === 'svg'
    ? ({ kind: 'code' as const, language: 'markup' })
    : rawContentDisplay.kind === 'markdown'
    ? ({ kind: 'code' as const, language: 'markdown' })
    : rawContentDisplay
  if (rawContentDisplay.kind === 'csv')
    return <CsvSourceContent content={content} onCollapse={onCollapse} />

  const isRenderable = rawContentDisplay.kind === 'markdown'
    || rawContentDisplay.kind === 'html'
    || rawContentDisplay.kind === 'svg'
  const contentClassName = isRenderable
    ? `tool-call-content tool-call-content-scrollable${
      rawContentDisplay.kind === 'markdown' ? ' tool-call-content-markdown' : ''
    }`
    : 'tool-call-content'
  const isReadOrWrite = call.name === 'read' || call.name === 'write'
  const startLine = isReadOrWrite ? readStartingLineNumber(call.args) : 1
  if (display.kind === 'code' && canHighlightFile(content))
    return (
      <section className={contentClassName} onClick={onCollapse}>
        <Suspense
          fallback={isReadOrWrite
            ? <NumberedPre content={content} startLine={startLine} />
            : <pre>{content}</pre>}
        >
          <LazyCodeHighlighter
            className='tool-call-syntax'
            customStyle={{ background: 'transparent', margin: 0, padding: '9px 10px' }}
            language={display.language}
            PreTag='div'
            showLineNumbers={isReadOrWrite}
            startingLineNumber={isReadOrWrite ? startLine : undefined}
            lineNumberStyle={isReadOrWrite ? lineNumberStyle : undefined}
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
      <section className={contentClassName} onClick={onCollapse}>
        <p className='tool-call-notice'>Highlighting disabled beyond 50,000 characters.</p>
        {isReadOrWrite
          ? <NumberedPre content={content} startLine={startLine} />
          : <pre>{content}</pre>}
      </section>
    )
  const plainSectionClass = isRenderable
    ? 'tool-call-content tool-call-content-scrollable'
    : 'tool-call-content'
  return (
    <section className={plainSectionClass} onClick={onCollapse}>
      {isReadOrWrite
        ? <NumberedPre content={content} startLine={startLine} />
        : <pre>{content}</pre>}
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
