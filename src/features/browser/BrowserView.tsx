import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  navigateBrowser,
  reloadBrowser,
  sendBrowserInput,
  setBrowserViewport,
  startBrowserSession,
  subscribeBrowserEvents,
} from '../../api.ts'
import type { BrowserSessionStatus, BrowserViewport } from '../../../shared/types.ts'
import type { BrowserStreamState } from '../../api.ts'
import { normalizeBrowserUrl } from './browser-url.ts'
import { browserMouseButton, cdpModifiers, mapPointerToPage } from './coordinates.ts'
import { useDocumentVisible } from './use-document-visible.ts'

const wheelFlushIntervalMs = 50

const viewportStorageKey = 'pi-livecraft.browser-viewport'
const defaultViewportChoice = '1280x900'

/** Predefined device viewports; capture and input coordinates follow the choice. */
const viewportPresets: Array<
  { group: string; entries: Array<{ label: string; viewport: BrowserViewport }> }
> = [
  {
    group: 'Desktop',
    entries: [
      { label: '1920 × 1080', viewport: { width: 1920, height: 1080, mobile: false } },
      { label: '1440 × 900', viewport: { width: 1440, height: 900, mobile: false } },
      { label: '1280 × 900', viewport: { width: 1280, height: 900, mobile: false } },
      { label: '1024 × 768', viewport: { width: 1024, height: 768, mobile: false } },
    ],
  },
  {
    group: 'Tablet',
    entries: [
      { label: '820 × 1180', viewport: { width: 820, height: 1180, mobile: true } },
      { label: '768 × 1024', viewport: { width: 768, height: 1024, mobile: true } },
    ],
  },
  {
    group: 'Mobile',
    entries: [
      { label: '390 × 844', viewport: { width: 390, height: 844, mobile: true } },
      { label: '375 × 812', viewport: { width: 375, height: 812, mobile: true } },
      { label: '360 × 800', viewport: { width: 360, height: 800, mobile: true } },
    ],
  },
]

const viewportChoiceEntries = viewportPresets.flatMap(({ entries }) => entries)

function readStoredViewportChoice(): string {
  const stored = window.localStorage.getItem(viewportStorageKey)
  return stored && viewportChoiceEntries.some(({ viewport }) => viewportKey(viewport) === stored)
    ? stored
    : defaultViewportChoice
}

function viewportKey(viewport: BrowserViewport): string {
  return `${viewport.width}x${viewport.height}`
}

/** Human-driven browser surface backed by an automatically started live browser. */
export function BrowserView({ browserId, onUrlCommit, url, workspacePath }: {
  browserId: string
  onUrlCommit: (url: string) => void
  url: string
  workspacePath: string
}) {
  const [address, setAddress] = useState(url)
  const [status, setStatus] = useState<BrowserSessionStatus>({ state: 'off' })
  const [streamState, setStreamState] = useState<BrowserStreamState>('connecting')
  const [hasFrame, setHasFrame] = useState(false)
  const [viewRefreshKey, setViewRefreshKey] = useState(0)
  const [zoomMode, setZoomMode] = useState<'auto' | 'natural'>('auto')
  const [zoomPercent, setZoomPercent] = useState(100)
  const [viewportChoice, setViewportChoice] = useState(readStoredViewportChoice)
  const target = useMemo(() => ({ browserId, workspacePath }), [browserId, workspacePath])
  const frameImageRef = useRef<HTMLImageElement>(null)
  /** Latest frame payload; the image is not mounted until the first frame flips hasFrame. */
  const lastFrameRef = useRef<string | null>(null)
  const composeInputRef = useRef<HTMLInputElement>(null)
  const liveSurfaceRef = useRef<HTMLDivElement>(null)
  const interactiveRef = useRef(false)
  const onUrlCommitRef = useRef(onUrlCommit)
  const requestedUrlRef = useRef(url)
  const didInitialNavigateRef = useRef(false)
  const lastMoveSentRef = useRef(0)
  const documentVisible = useDocumentVisible()
  const live = status.state === 'live'
  const browserInteractive = live && streamState === 'connected'
  const streamStatusKind: BrowserStreamState = browserInteractive
    ? 'connected'
    : streamState === 'connecting' || status.state === 'off' || status.state === 'starting'
    ? 'connecting'
    : 'stale'
  const streamStatusLabel = streamStatusKind === 'connected'
    ? 'Live view connected'
    : streamStatusKind === 'connecting'
    ? 'Connecting live view…'
    : 'Live browser stream stale'
  interactiveRef.current = browserInteractive
  onUrlCommitRef.current = onUrlCommit
  requestedUrlRef.current = url

  useEffect(() => setAddress(url), [url])

  // Paint the frame that mounted the image: on a fresh mount the first (and,
  // for a settled static page, only) frame can arrive before the image exists,
  // and dropping it would leave the placeholder gif on screen forever.
  useEffect(() => {
    const image = frameImageRef.current
    const data = lastFrameRef.current
    if (image && data && !image.src.startsWith('data:image/jpeg')) {
      image.src = `data:image/jpeg;base64,${data}`
    }
  }, [hasFrame])

  // Report the effective zoom whenever the rendered frame size changes.
  useEffect(() => {
    const image = frameImageRef.current
    if (!hasFrame || !image || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (image.naturalWidth > 0) {
        setZoomPercent(Math.round((image.clientWidth / image.naturalWidth) * 100))
      }
    })
    observer.observe(image)
    return () => observer.disconnect()
  }, [hasFrame, zoomMode])

  function selectViewport(choice: string): void {
    if (!browserInteractive) return
    setViewportChoice(choice)
    window.localStorage.setItem(viewportStorageKey, choice)
    const preset = viewportChoiceEntries.find(({ viewport }) => viewportKey(viewport) === choice)
    if (preset && status.state === 'live') {
      void setBrowserViewport(target, preset.viewport).catch(() => {})
    }
  }

  // Apply the stored device choice once, when a session becomes live.
  const wasLiveRef = useRef(false)
  useEffect(() => {
    const wasLive = wasLiveRef.current
    wasLiveRef.current = status.state === 'live'
    if (wasLive || status.state !== 'live' || !status.viewport) return
    if (viewportKey(status.viewport) === viewportChoice) return
    const preset = viewportChoiceEntries.find(
      ({ viewport }) => viewportKey(viewport) === viewportChoice,
    )
    if (preset) void setBrowserViewport(target, preset.viewport).catch(() => {})
  }, [status, target, viewportChoice])

  // Reset the pane only when the target instance changes; returning from a
  // hidden document keeps the last frame and status until fresh events arrive.
  const previousTargetRef = useRef(target)
  useEffect(() => {
    if (previousTargetRef.current === target) return
    previousTargetRef.current = target
    setStatus({ state: 'off' })
    setStreamState('connecting')
    setHasFrame(false)
    didInitialNavigateRef.current = false
  }, [target])

  useEffect(() => {
    // Hidden documents cannot watch frames: closing the stream releases the
    // backend viewer so the screencast stops. Returning re-subscribes silently —
    // the last frame stays visible (Firefox reconnects event streams lazily) —
    // and the idempotent start call revives a browser that stopped while
    // nobody watched. The remembered URL is applied once per instance, so a
    // page moved by attached tooling while hidden is never navigated back.
    if (!documentVisible) return
    const shouldNavigateInitial = !didInitialNavigateRef.current
    didInitialNavigateRef.current = true
    setStreamState('connecting')
    let active = true
    const unsubscribe = subscribeBrowserEvents(target, {
      // Frames bypass React state: writing the data URL straight to the image
      // avoids a full component re-render at frame rate.
      onFrame: (data) => {
        if (!active) return
        lastFrameRef.current = data
        const image = frameImageRef.current
        if (image) image.src = `data:image/jpeg;base64,${data}`
        else setHasFrame(true)
      },
      onUrl: (nextUrl) => {
        if (active) onUrlCommitRef.current(nextUrl)
      },
      onStatus: (next) => {
        if (!active) return
        setStatus(next)
        if (next.state !== 'live') setHasFrame(false)
      },
      onStreamState: (next) => {
        if (active) setStreamState(next)
      },
    })
    void startBrowserSession(target)
      .then((next) => {
        if (!active) return
        setStatus(next)
        // Read the requested URL at resolution time: when the pane remounts on a
        // workspace switch it first sees the previous workspace's URL until the
        // app state catches up, and that stale value must never steer the new
        // instance's first navigation.
        const requestedUrl = requestedUrlRef.current
        if (shouldNavigateInitial && requestedUrl && requestedUrl !== next.url) {
          return navigateBrowser(target, requestedUrl)
        }
      })
      .catch(() => {})
    return () => {
      active = false
      unsubscribe()
    }
  }, [documentVisible, target, viewRefreshKey])

  useEffect(() => {
    const element = liveSurfaceRef.current
    if (!browserInteractive || !element) return
    const pending = { x: 0, y: 0, deltaX: 0, deltaY: 0 }
    let wheelFlushTimer: number | null = null
    const handleWheel = (nativeEvent: WheelEvent): void => {
      if (!interactiveRef.current) return
      nativeEvent.preventDefault()
      const image = frameImageRef.current
      if (!image) return
      const { x, y } = mapPointerToPage(nativeEvent, {
        rect: image.getBoundingClientRect(),
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      })
      pending.x = x
      pending.y = y
      pending.deltaX += nativeEvent.deltaX
      pending.deltaY += nativeEvent.deltaY
      if (wheelFlushTimer !== null) return
      wheelFlushTimer = window.setTimeout(() => {
        wheelFlushTimer = null
        sendBrowserInput(target, {
          type: 'mouseWheel',
          x: pending.x,
          y: pending.y,
          deltaX: pending.deltaX,
          deltaY: pending.deltaY,
          modifiers: 0,
        })
        pending.deltaX = 0
        pending.deltaY = 0
      }, wheelFlushIntervalMs)
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', handleWheel)
      if (wheelFlushTimer !== null) window.clearTimeout(wheelFlushTimer)
      pending.deltaX = 0
      pending.deltaY = 0
    }
  }, [browserInteractive, target])

  function navigateWhenReady(next: string): void {
    if (!browserInteractive) return
    void navigateBrowser(target, next).catch(() => {})
  }

  function navigate(event: FormEvent): void {
    event.preventDefault()
    if (!browserInteractive) return
    const next = normalizeBrowserUrl(address)
    if (!next) {
      setAddress(url)
      return
    }
    onUrlCommit(next)
    navigateWhenReady(next)
  }

  function reloadPage(): void {
    if (!browserInteractive || !url) return
    void reloadBrowser(target).catch(() => {})
  }

  function reconnectView(): void {
    setStreamState('connecting')
    setViewRefreshKey((current) => current + 1)
  }

  function pageCoordinates(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const image = frameImageRef.current
    if (!image) return { x: 0, y: 0 }
    return mapPointerToPage(event, {
      rect: image.getBoundingClientRect(),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    })
  }

  function dispatchMouse(
    event: ReactPointerEvent<HTMLImageElement>,
    type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
  ): void {
    if (!browserInteractive) return
    const { x, y } = pageCoordinates(event)
    sendBrowserInput(target, {
      type,
      x,
      y,
      button: type === 'mouseMoved' && event.buttons === 0
        ? 'none'
        : browserMouseButton(event.button),
      clickCount: type === 'mouseMoved' ? 0 : event.detail || 1,
      modifiers: cdpModifiers(event),
    })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLImageElement>): void {
    if (!browserInteractive) return
    // Prevent the browser's default focus shift to the container so the compose
    // input keeps focus and receives typing for IME composition.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    composeInputRef.current?.focus()
    // Hover before pressing so hover-gated controls (menus, banners) react.
    dispatchMouse(event, 'mouseMoved')
    dispatchMouse(event, 'mousePressed')
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLImageElement>): void {
    if (!browserInteractive) return
    const now = performance.now()
    if (now - lastMoveSentRef.current < 32) return
    lastMoveSentRef.current = now
    dispatchMouse(event, 'mouseMoved')
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLImageElement>): void {
    if (!browserInteractive) return
    if (event.button === 3 || event.button === 4) event.preventDefault()
    dispatchMouse(event, 'mouseReleased')
  }

  function handleAuxClick(event: ReactMouseEvent<HTMLImageElement>): void {
    if (event.button === 3 || event.button === 4) event.preventDefault()
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!browserInteractive) return
    if (event.ctrlKey || event.metaKey) {
      // Let Ctrl+V through untouched: canceling its keydown would cancel the
      // paste event the forwarding handler depends on. Swallow other host
      // shortcuts (reload, focus bar) so they do not act on the app instead.
      if (event.key.toLowerCase() !== 'v') event.preventDefault()
      return
    }
    event.preventDefault()
    const common = {
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      modifiers: cdpModifiers(event),
    }
    if (event.key.length === 1) {
      sendBrowserInput(target, { ...common, type: 'keyDown', text: event.key })
      sendBrowserInput(target, { ...common, type: 'keyUp' })
      return
    }
    sendBrowserInput(target, { ...common, type: 'keyDown' })
    sendBrowserInput(target, { ...common, type: 'keyUp' })
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLDivElement>): void {
    if (!browserInteractive || !event.data) return
    sendBrowserInput(target, { type: 'insertText', text: event.data })
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>): void {
    if (!browserInteractive) return
    event.preventDefault()
    const text = event.clipboardData.getData('text')
    if (text) sendBrowserInput(target, { type: 'insertText', text: text.slice(0, 10_000) })
  }

  return (
    <div aria-label='Browser' className='browser-view'>
      <form className='browser-bar' onSubmit={navigate}>
        <select
          aria-label='Browser viewport size'
          className='browser-bar-select'
          disabled={!browserInteractive}
          onChange={(event) => selectViewport(event.target.value)}
          title='Viewport size'
          value={viewportChoice}
        >
          {viewportPresets.map(({ group, entries }) => (
            <optgroup key={group} label={group}>
              {entries.map(({ label, viewport }) => (
                <option key={label} value={viewportKey(viewport)}>{label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select
          aria-label='Frame zoom mode'
          className='browser-bar-select'
          disabled={!browserInteractive}
          onChange={(event) => setZoomMode(event.target.value === 'natural' ? 'natural' : 'auto')}
          title='Frame zoom'
          value={zoomMode}
        >
          <option value='auto'>Auto</option>
          <option value='natural'>100%</option>
        </select>
        {zoomMode === 'auto' && <span className='browser-zoom-value'>{zoomPercent}%</span>}
        <input
          disabled={!browserInteractive}
          onChange={(event) => setAddress(event.target.value)}
          placeholder='Enter address — e.g. localhost:3000'
          spellCheck={false}
          type='text'
          value={address}
        />
        <div className='browser-bar-actions'>
          <button
            aria-label='Reload page contents'
            className='browser-reload'
            disabled={!browserInteractive || !url}
            onClick={reloadPage}
            title='Reload page contents'
            type='button'
          >
            ↻
          </button>
          {url && (
            <a
              aria-disabled={!browserInteractive}
              aria-label='Open in new window'
              className={`browser-external${browserInteractive ? '' : ' disabled'}`}
              href={url}
              onClick={(event) => {
                if (!browserInteractive) event.preventDefault()
              }}
              rel='noreferrer'
              tabIndex={browserInteractive ? 0 : -1}
              target='_blank'
            >
              ↗
            </a>
          )}
        </div>
      </form>
      {status.state === 'crashed' && status.error && (
        <p className='browser-session-error' role='alert'>
          {status
            .error}
        </p>
      )}
      <div
        aria-disabled={!browserInteractive}
        className={`browser-live${zoomMode === 'natural' ? ' natural' : ''}${
          browserInteractive ? '' : ' unavailable'
        }`}
        onCompositionEnd={handleCompositionEnd}
        onFocus={(event) => {
          // Paste and typing need an editable focus target; the hidden
          // compose input provides it whenever the surface itself gains
          // focus (for example after clicking the letterboxed area).
          if (browserInteractive && event.target === event.currentTarget) {
            composeInputRef.current?.focus()
          }
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        ref={liveSurfaceRef}
        tabIndex={browserInteractive ? 0 : -1}
      >
        {hasFrame
          ? (
            <img
              alt='Live browser view'
              className='browser-frame'
              decoding='async'
              draggable={false}
              onAuxClick={handleAuxClick}
              onContextMenu={(event) => event.preventDefault()}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              ref={frameImageRef}
              src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
            />
          )
          : (
            <p className='browser-hint'>
              {status.state === 'crashed' ? 'Browser unavailable.' : 'Starting browser…'}
            </p>
          )}
        {hasFrame && !browserInteractive && (
          <div className='browser-stream-overlay' role='status'>
            <strong>
              {streamStatusKind === 'connecting'
                ? 'Connecting to live browser…'
                : 'Live browser stream stale'}
            </strong>
            <span>
              {streamStatusKind === 'connecting'
                ? 'Waiting for the stream to recover.'
                : 'Reconnect to continue interacting with this page.'}
            </span>
          </div>
        )}
        <input
          aria-hidden='true'
          className='browser-compose'
          ref={composeInputRef}
          tabIndex={-1}
          type='text'
        />
      </div>
      {(status.endpoint || streamStatusKind !== 'connected') && (
        <div className='browser-attach'>
          <span
            aria-live='polite'
            className='browser-stream-status'
            data-state={streamStatusKind}
          >
            <span aria-hidden='true' className='browser-stream-dot' />
            {streamStatusLabel}
          </span>
          {status.endpoint && (
            <>
              <span className='browser-attach-label'>Attach browser tooling</span>
              <code>{status.endpoint}</code>
            </>
          )}
          <button
            aria-label='Reconnect live browser view'
            className={`browser-stream-reconnect${streamStatusKind === 'stale' ? ' stale' : ''}`}
            disabled={streamStatusKind === 'connecting'}
            onClick={reconnectView}
            title='Reconnect live browser view'
            type='button'
          >
            ⟳
          </button>
          {status.endpoint && (
            <button
              onClick={() =>
                void navigator.clipboard?.writeText(status.endpoint ?? '').catch(() => {})}
              type='button'
            >
              Copy
            </button>
          )}
        </div>
      )}
    </div>
  )
}
