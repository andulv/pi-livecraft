import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Markdown } from '../conversation/Markdown.tsx'
import { BrowserView } from '../browser/BrowserView.tsx'
import { TerminalView } from '../terminal/TerminalView.tsx'
import { getWorkspaceFile } from '../../api.ts'
import { classifyWorkspaceFilePreview } from '../../../shared/file-preview.ts'
import { FilePreviewError, MediaFilePreview, SandboxedMarkupPreview } from './FilePreview.tsx'
import { maxFilePaneShare, minFilePaneShare } from './file-pane-width.ts'
import { parseGitDiff } from '../git/git-diff.ts'
import type { GitDiffTab } from '../workspace/workspace-viewer-state.ts'

interface FileState {
  content: string
  error: string | null
  loading: boolean
}

/** Preview-zoom bounds and step, in percent of natural size. */
const minPreviewZoomPercent = 25
const maxPreviewZoomPercent = 400
const previewZoomStepPercent = 10
/** Datalist choices for the percent field: 10% steps through the common
 *  range, coarser above 200%; any value in bounds can be typed directly. */
const previewZoomChoices: readonly number[] = [
  ...Array.from({ length: 16 }, (_, index) => 50 + index * 10),
  250,
  300,
  350,
  400,
]

export function FileContentPane({
  activeGitDiffId,
  activePath,
  browserActive,
  browserId,
  browserOpen,
  browserUrl,
  gitDiffTabs,
  onActivate,
  onActivateGitDiff,
  onActivateBrowser,
  onActivateTerminal,
  onBrowserUrlCommit,
  onClose,
  onCloseGitDiff,
  onCloseBrowser,
  onCloseTerminal,
  onOpenBrowser,
  onOpenTerminal,
  onPinTab,
  onResize,
  openPaths,
  previewTabId,
  share,
  terminalActive,
  terminalId,
  terminalOpen,
  workspacePath,
}: {
  activeGitDiffId: string | null
  activePath: string | null
  browserActive: boolean
  gitDiffTabs: readonly GitDiffTab[]
  browserId: string
  browserOpen: boolean
  browserUrl: string
  onActivate: (path: string) => void
  onActivateGitDiff: (id: string) => void
  onActivateBrowser: () => void
  onActivateTerminal: () => void
  onBrowserUrlCommit: (url: string) => void
  onClose: (path: string) => void
  onCloseGitDiff: (id: string) => void
  onCloseBrowser: () => void
  onCloseTerminal: () => void
  onOpenBrowser: () => void
  onOpenTerminal: () => void
  onPinTab: (id: string) => void
  onResize: (share: number) => void
  openPaths: readonly string[]
  previewTabId: string | null
  share: number
  terminalActive: boolean
  terminalId: string
  terminalOpen: boolean
  workspacePath: string
}) {
  const [files, setFiles] = useState<Record<string, FileState>>({})
  const [rawByPath, setRawByPath] = useState<Record<string, boolean>>({})
  const [zoomByPath, setZoomByPath] = useState<Record<string, number>>({})
  const filesRef = useRef(files)
  filesRef.current = files
  const previewKind = activePath ? classifyWorkspaceFilePreview(activePath) : 'text'

  useEffect(() => {
    setFiles({})
    setRawByPath({})
    setZoomByPath({})
  }, [workspacePath])

  useEffect(() => {
    const kind = activePath ? classifyWorkspaceFilePreview(activePath) : 'text'
    if (
      !activePath
      // Media is fetched as raw bytes by its own viewer, not as text.
      || kind === 'image'
      || kind === 'pdf'
      || filesRef.current[activePath]
    ) return
    let cancelled = false
    setFiles((current) => ({
      ...current,
      [activePath]: { content: '', error: null, loading: true },
    }))
    void getWorkspaceFile(workspacePath, activePath)
      .then((file) => {
        if (!cancelled)
          setFiles((current) => ({
            ...current,
            [activePath]: { content: file.content, error: null, loading: false },
          }))
      })
      .catch((cause) => {
        if (!cancelled)
          setFiles((current) => ({
            ...current,
            [activePath]: {
              content: '',
              error: cause instanceof Error ? cause.message : String(cause),
              loading: false,
            },
          }))
      })
    return () => {
      cancelled = true
    }
  }, [activePath, workspacePath])

  const activeFile = activePath ? files[activePath] : undefined
  const activeGitDiff = gitDiffTabs.find((tab) => tab.id === activeGitDiffId)
  // HTML defaults to source: rendering project HTML without its scripts and
  // relative assets is intentionally incomplete. SVG defaults to preview.
  const viewRaw = activePath ? (rawByPath[activePath] ?? previewKind === 'html') : false
  const zoomPercent = activePath ? (zoomByPath[activePath] ?? 100) : 100
  // While the percent field is focused it holds the text being typed; on commit
  // it clears and the field falls back to the effective level.
  const [zoomDraft, setZoomDraft] = useState<string | null>(null)

  function setViewRaw(raw: boolean): void {
    if (activePath) setRawByPath((current) => ({ ...current, [activePath]: raw }))
  }

  /** Clamps to the supported range; out-of-range typed values land on a bound. */
  function setZoom(percent: number): void {
    const clamped = Math.min(
      maxPreviewZoomPercent,
      Math.max(minPreviewZoomPercent, Math.round(percent)),
    )
    if (activePath) setZoomByPath((current) => ({ ...current, [activePath]: clamped }))
  }

  function commitZoomDraft(): void {
    if (zoomDraft === null) return
    const digits = zoomDraft.replace(/[^0-9]/g, '')
    setZoomDraft(null)
    if (digits !== '') setZoom(Number.parseInt(digits, 10))
  }

  /** Installs temporary listeners needed for pane pointer resizing. */
  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const handle = event.currentTarget
    const workspace = handle.closest<HTMLElement>('.workspace')
    const pane = handle.parentElement
    if (!workspace || !pane) return

    const workspaceWidth = workspace.getBoundingClientRect().width
    const initialPaneWidth = pane.getBoundingClientRect().width
    const initialX = event.clientX
    if (workspaceWidth <= 0) return

    handle.setPointerCapture(event.pointerId)

    const resize = (moveEvent: PointerEvent): void =>
      onResize((initialPaneWidth + initialX - moveEvent.clientX) / workspaceWidth)
    const stop = (): void => {
      handle.removeEventListener('pointermove', resize)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      handle.removeEventListener('lostpointercapture', stop)
    }

    handle.addEventListener('pointermove', resize)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
    handle.addEventListener('lostpointercapture', stop)
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const adjustment = event.key === 'ArrowLeft' ? 0.02 : event.key === 'ArrowRight' ? -0.02 : 0
    if (adjustment) {
      event.preventDefault()
      onResize(share + adjustment)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onResize(minFilePaneShare)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onResize(maxFilePaneShare)
    }
  }
  return (
    <aside aria-label='File contents' className='file-content-pane'>
      <div
        aria-label='Resize file preview pane'
        aria-orientation='vertical'
        aria-valuemax={maxFilePaneShare * 100}
        aria-valuemin={minFilePaneShare * 100}
        aria-valuenow={Math.round(share * 100)}
        aria-valuetext={`${Math.round(share * 100)}% of workspace`}
        className='file-pane-resize-handle'
        onKeyDown={resizeWithKeyboard}
        onPointerDown={startResize}
        role='separator'
        tabIndex={0}
      />
      <div className='file-tabs' role='tablist' aria-label='Open files'>
        {openPaths.map((path) => (
          <div
            className={`file-tab${path === activePath ? ' active' : ''}${
              previewTabId === `file:${path}` ? ' preview' : ''
            }`}
            key={path}
          >
            <button
              aria-selected={path === activePath}
              onClick={() => onActivate(path)}
              onDoubleClick={() => onPinTab(`file:${path}`)}
              role='tab'
              title={path}
              type='button'
            >
              {path
                .split(/[\\/]/)
                .at(-1)}
            </button>
            <button
              aria-label={`Close ${
                path
                  .split(/[\\/]/)
                  .at(-1)
              }`}
              className='file-tab-close'
              onClick={() => onClose(path)}
              type='button'
            >
              ×
            </button>
          </div>
        ))}
        {gitDiffTabs.map((tab) => (
          <div
            className={`file-tab${
              activeGitDiff?.id === tab.id
                ? ' active'
                : ''
            }${
              previewTabId === tab.id
                ? ' preview'
                : ''
            }`}
            key={tab.id}
          >
            <button
              aria-selected={activeGitDiff?.id === tab.id}
              onClick={() => onActivateGitDiff(tab.id)}
              onDoubleClick={() => onPinTab(tab.id)}
              role='tab'
              title={`${tab.path}${tab.commitHash ? ` (${tab.commitHash.slice(0, 7)})` : ''} diff`}
              type='button'
            >
              {tab.path.split(/[\\/]/).at(-1)} · Diff
            </button>
            <button
              aria-label={`Close ${tab.path} diff`}
              className='file-tab-close'
              onClick={() => onCloseGitDiff(tab.id)}
              type='button'
            >
              ×
            </button>
          </div>
        ))}
        {browserOpen && (
          <div className={`file-tab${browserActive ? ' active' : ''}`}>
            <button
              aria-selected={browserActive}
              onClick={onActivateBrowser}
              role='tab'
              type='button'
            >
              <GlobeIcon />
              Browser
            </button>
            <button
              aria-label='Close browser'
              className='file-tab-close'
              onClick={onCloseBrowser}
              type='button'
            >
              ×
            </button>
          </div>
        )}
        {!browserOpen && (
          <button
            aria-label='Open browser'
            className='file-tab-open-browser'
            onClick={onOpenBrowser}
            title='Open browser'
            type='button'
          >
            <GlobeIcon />
          </button>
        )}
        {terminalOpen && (
          <div className={`file-tab${terminalActive ? ' active' : ''}`}>
            <button
              aria-selected={terminalActive}
              onClick={onActivateTerminal}
              role='tab'
              type='button'
            >
              <TerminalIcon />
              Terminal
            </button>
            <button
              aria-label='Close terminal'
              className='file-tab-close'
              onClick={onCloseTerminal}
              type='button'
            >
              ×
            </button>
          </div>
        )}
        {!terminalOpen && (
          <button
            aria-label='Open terminal'
            className='file-tab-open-browser'
            onClick={onOpenTerminal}
            title='Open terminal'
            type='button'
          >
            <TerminalIcon />
          </button>
        )}
      </div>
      {terminalActive
        ? (
          <div className='file-content'>
            <TerminalView
              terminalId={terminalId}
              workspacePath={workspacePath}
            />
          </div>
        )
        : browserActive
        ? (
          <div className='file-content'>
            <BrowserView
              browserId={browserId}
              onUrlCommit={onBrowserUrlCommit}
              url={browserUrl}
              workspacePath={workspacePath}
            />
          </div>
        )
        : activeGitDiff
        ? (
          <GitDiffView
            after={activeGitDiff.after}
            afterAvailable={activeGitDiff.afterAvailable}
            key={activeGitDiff.id}
            before={activeGitDiff.before}
            beforeAvailable={activeGitDiff.beforeAvailable}
            diff={activeGitDiff.diff}
            path={activeGitDiff.path}
          />
        )
        : activePath
        ? (
          <div className='file-content'>
            <div className='file-content-header'>
              <span title={activePath}>{activePath}</span>
              {(previewKind === 'markdown' || previewKind === 'html' || previewKind === 'svg') && (
                <div
                  aria-label={previewKind === 'markdown' ? 'Markdown display' : 'Markup display'}
                  className='file-view-toggle'
                  role='group'
                >
                  <button
                    aria-pressed={!viewRaw}
                    onClick={() => setViewRaw(false)}
                    type='button'
                  >
                    {previewKind === 'markdown' ? 'Markdown' : 'Preview'}
                  </button>
                  <button
                    aria-pressed={viewRaw}
                    onClick={() => setViewRaw(true)}
                    type='button'
                  >
                    {previewKind === 'markdown' ? 'Raw' : 'Source'}
                  </button>
                </div>
              )}
              {(previewKind === 'html' || previewKind === 'svg') && !viewRaw && (
                <div aria-label='Preview zoom' className='file-zoom' role='group'>
                  <button
                    aria-label='Zoom out'
                    disabled={zoomPercent <= minPreviewZoomPercent}
                    onClick={() =>
                      setZoom(zoomPercent - previewZoomStepPercent)}
                    type='button'
                  >
                    −
                  </button>
                  <input
                    aria-label='Zoom percent'
                    inputMode='numeric'
                    list='file-zoom-levels'
                    onBlur={commitZoomDraft}
                    onChange={(event) =>
                      setZoomDraft(
                        event
                          .target
                          .value,
                      )}
                    onFocus={() =>
                      setZoomDraft(String(zoomPercent))}
                    onKeyDown={(event) => {
                      if (
                        event
                          .key === 'Enter'
                      )
                        commitZoomDraft()
                    }}
                    title='Zoom level; type a value between 25 and 400'
                    type='text'
                    value={zoomDraft ?? String(zoomPercent)}
                  />
                  <datalist id='file-zoom-levels'>
                    {previewZoomChoices
                      .map((choice) => <option key={choice} value={choice} />)}
                  </datalist>
                  <button
                    aria-label='Zoom in'
                    disabled={zoomPercent >= maxPreviewZoomPercent}
                    onClick={() =>
                      setZoom(zoomPercent + previewZoomStepPercent)}
                    type='button'
                  >
                    +
                  </button>
                </div>
              )}
              <small>Read-only preview</small>
            </div>
            {(previewKind === 'image' || previewKind === 'pdf')
              ? (
                <MediaFilePreview
                  kind={previewKind}
                  path={activePath}
                  workspacePath={workspacePath}
                />
              )
              : (
                <>
                  {activeFile?.loading && <p className='file-content-status'>Loading file…</p>}
                  {activeFile?.error && (
                    <FilePreviewError
                      message={activeFile.error}
                      path={activePath}
                      workspacePath={workspacePath}
                    />
                  )}
                  {activeFile && !activeFile.loading && !activeFile.error
                    && (previewKind !== 'text' && !viewRaw
                      ? previewKind === 'markdown'
                        ? (
                          <div className='file-content-markdown'>
                            <Markdown renderFrontmatter>{activeFile.content}</Markdown>
                          </div>
                        )
                        : (
                          <SandboxedMarkupPreview
                            content={activeFile.content}
                            path={activePath}
                            zoomPercent={zoomPercent}
                          />
                        )
                      : (
                        <textarea
                          aria-label={activePath}
                          readOnly
                          spellCheck={false}
                          value={activeFile.content}
                        />
                      ))}
                </>
              )}
          </div>
        )
        : (
          <p className='file-content-empty'>
            Open a file from the explorer, or open the browser or terminal.
          </p>
        )}
    </aside>
  )
}

/** Lets a Git tab show its patch or either complete file version. */
function GitDiffView({ after, afterAvailable, before, beforeAvailable, diff, path }: {
  after: string
  afterAvailable: boolean
  before: string
  beforeAvailable: boolean
  diff: string
  path: string
}) {
  const [view, setView] = useState<'diff' | 'before' | 'after'>('diff')
  const lines = parseGitDiff(diff)
  const versionContent = view === 'before' ? before : after

  return (
    <div className='file-content'>
      <div className='file-content-header'>
        <span title={path}>{path}</span>
        <div aria-label='Git diff display' className='file-view-toggle' role='group'>
          {(['diff', 'before', 'after'] as const).map((option) => {
            const unavailable = (option === 'before' && !beforeAvailable)
              || (option === 'after' && !afterAvailable)
            return (
              <button
                aria-pressed={view === option}
                disabled={unavailable}
                key={option}
                onClick={() => setView(option)}
                type='button'
              >
                {{ diff: 'Diff', before: 'Original', after: 'New' }[option]}
              </button>
            )
          })}
        </div>
        <small>Git diff</small>
      </div>
      {view === 'diff'
        ? lines.length === 0
          ? <p className='file-content-status'>No textual differences to display.</p>
          : (
            <section aria-label='File diff' className='git-diff'>
              {lines.map((line, index) => (
                <div className={`git-diff-line ${line.kind}`} key={index}>
                  <span>{line.oldLine ?? ''}</span>
                  <span>{line.newLine ?? ''}</span>
                  <i aria-hidden='true'>
                    {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                  </i>
                  <code>{line.content}</code>
                </div>
              ))}
            </section>
          )
        : <FileVersionView content={versionContent} path={path} />}
    </div>
  )
}

/** Renders a version through the same content dispatch point used by future viewers. */
function FileVersionView({ content, path }: { content: string; path: string }) {
  const isMarkdown = /\.(md|markdown)$/i.test(path)
  return isMarkdown
    ? (
      <div className='file-content-markdown'>
        <Markdown renderFrontmatter>{content}</Markdown>
      </div>
    )
    : <textarea aria-label={`${path} ${'version'}`} readOnly spellCheck={false} value={content} />
}

function GlobeIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='13'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.6'
      viewBox='0 0 24 24'
      width='13'
    >
      <circle cx='12' cy='12' r='9' />
      <path d='M3 12h18' />
      <path d='M12 3c2.5 2.5 4 5.6 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.6-4-9s1.5-6.5 4-9z' />
    </svg>
  )
}

/** Compact prompt glyph marking the embedded terminal tab. */
function TerminalIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='13'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.6'
      viewBox='0 0 24 24'
      width='13'
    >
      <polyline points='4 17 10 11 4 5' />
      <line x1='12' x2='20' y1='19' y2='19' />
    </svg>
  )
}
