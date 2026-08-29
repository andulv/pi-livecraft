import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Markdown } from '../conversation/Markdown.tsx'
import { BrowserView } from '../browser/BrowserView.tsx'
import { getWorkspaceFile } from '../../api.ts'
import { maxFilePaneWidth, minFilePaneWidth } from './file-pane-width.ts'

interface FileState {
  content: string
  error: string | null
  loading: boolean
}

export function FileContentPane({
  activePath,
  browserActive,
  browserOpen,
  browserUrl,
  onActivate,
  onActivateBrowser,
  onBrowserUrlCommit,
  onClose,
  onCloseBrowser,
  onOpenBrowser,
  onResize,
  openPaths,
  width,
  workspacePath,
}: {
  activePath: string | null
  browserActive: boolean
  browserOpen: boolean
  browserUrl: string
  onActivate: (path: string) => void
  onActivateBrowser: () => void
  onBrowserUrlCommit: (url: string) => void
  onClose: (path: string) => void
  onCloseBrowser: () => void
  onOpenBrowser: () => void
  onResize: (width: number) => void
  openPaths: readonly string[]
  width: number
  workspacePath: string
}) {
  const [files, setFiles] = useState<Record<string, FileState>>({})
  const [viewRaw, setViewRaw] = useState(false)
  const filesRef = useRef(files)
  filesRef.current = files

  useEffect(() => {
    setFiles({})
  }, [workspacePath])

  useEffect(() => {
    if (!activePath || filesRef.current[activePath]) return
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
  const isMarkdown = activePath !== null && /\.(md|markdown)$/i.test(activePath)

  /** Installs temporary listeners needed for pane pointer resizing. */
  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const handle = event.currentTarget
    const initialX = event.clientX
    const initialWidth = width
    handle.setPointerCapture(event.pointerId)

    const resize = (moveEvent: PointerEvent): void =>
      onResize(initialWidth + initialX - moveEvent.clientX)
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
    const adjustment = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0
    if (adjustment) {
      event.preventDefault()
      onResize(width + adjustment)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onResize(minFilePaneWidth)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onResize(maxFilePaneWidth)
    }
  }
  return (
    <aside aria-label='File contents' className='file-content-pane'>
      <div
        aria-label='Resize file preview pane'
        aria-orientation='vertical'
        aria-valuemax={maxFilePaneWidth}
        aria-valuemin={minFilePaneWidth}
        aria-valuenow={width}
        className='file-pane-resize-handle'
        onKeyDown={resizeWithKeyboard}
        onPointerDown={startResize}
        role='separator'
        tabIndex={0}
      />
      <div className='file-tabs' role='tablist' aria-label='Open files'>
        {openPaths.map((path) => (
          <div className={`file-tab${path === activePath ? ' active' : ''}`} key={path}>
            <button
              aria-selected={path === activePath}
              onClick={() =>
                onActivate(path)}
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
              onClick={() =>
                onClose(path)}
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
      </div>
      {browserActive
        ? (
          <div className='file-content'>
            <BrowserView onUrlCommit={onBrowserUrlCommit} url={browserUrl} />
          </div>
        )
        : activePath
        ? (
          <div className='file-content'>
            <div className='file-content-header'>
              <span title={activePath}>{activePath}</span>
              {isMarkdown && (
                <div aria-label='Markdown display' className='file-view-toggle' role='group'>
                  <button
                    aria-pressed={!viewRaw}
                    onClick={() =>
                      setViewRaw(false)}
                    type='button'
                  >
                    Markdown
                  </button>
                  <button
                    aria-pressed={viewRaw}
                    onClick={() =>
                      setViewRaw(true)}
                    type='button'
                  >
                    Raw
                  </button>
                </div>
              )}
              <small>Read-only preview</small>
            </div>
            {activeFile?.loading && <p className='file-content-status'>Loading file…</p>}
            {activeFile?.error && <p className='file-content-status error'>{activeFile.error}</p>}
            {activeFile && !activeFile.loading && !activeFile.error
              && (isMarkdown && !viewRaw
                ? (
                  <div className='file-content-markdown'>
                    <Markdown renderFrontmatter>{activeFile.content}</Markdown>
                  </div>
                )
                : (
                  <textarea
                    aria-label={activePath}
                    readOnly
                    spellCheck={false}
                    value={activeFile.content}
                  />
                ))}
          </div>
        )
        : <p className='file-content-empty'>Open a file from the explorer, or open the browser.</p>}
    </aside>
  )
}

/** Compact globe marking browser destinations. */
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
