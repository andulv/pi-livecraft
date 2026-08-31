import {
  useEffect,
  useRef,
  useState,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  navigateBrowser,
  sendBrowserInput,
  setBrowserViewport,
  startBrowserSession,
  stopBrowserSession,
  subscribeBrowserEvents,
} from '../../api.ts'
import type { BrowserSessionStatus, BrowserViewport } from '../../../shared/types.ts'
import { normalizeBrowserUrl } from './browser-url.ts'
import { cdpModifiers, mapPointerToPage } from './coordinates.ts'

const wheelFlushIntervalMs = 50
const pendingWheel = { x: 0, y: 0, deltaX: 0, deltaY: 0 }
let wheelFlushTimer: number | null = null

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

/** Human-driven browser surface: an address bar, a livecast view, and an iframe fallback. */
export function BrowserView({ onUrlCommit, url }: {
  onUrlCommit: (url: string) => void
  url: string
}) {
  const [address, setAddress] = useState(url)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [status, setStatus] = useState<BrowserSessionStatus>({ state: 'off' })
  const [hasFrame, setHasFrame] = useState(false)
  const [zoomMode, setZoomMode] = useState<'auto' | 'natural'>('auto')
  const [zoomPercent, setZoomPercent] = useState(100)
  const [viewportChoice, setViewportChoice] = useState(readStoredViewportChoice)
  const frameImageRef = useRef<HTMLImageElement>(null)
  const composeInputRef = useRef<HTMLInputElement>(null)
  const liveRef = useRef(false)
  const lastMoveSentRef = useRef(0)
  const live = status.state === 'live'
  liveRef.current = live

  useEffect(() => setAddress(url), [url])

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
    setViewportChoice(choice)
    window.localStorage.setItem(viewportStorageKey, choice)
    const preset = viewportChoiceEntries.find(({ viewport }) => viewportKey(viewport) === choice)
    if (preset && status.state === 'live') {
      void setBrowserViewport(preset.viewport).catch(() => {})
    }
  }

  // Apply the stored device choice once, when a session becomes live.
  const wasLiveRef = useRef(false)
  useEffect(() => {
    const wasLive = wasLiveRef.current
    wasLiveRef.current = status.state === 'live'
    if (!wasLive || status.state !== 'live' || !status.viewport) return
    if (viewportKey(status.viewport) === viewportChoice) return
    const preset = viewportChoiceEntries.find(
      ({ viewport }) => viewportKey(viewport) === viewportChoice,
    )
    if (preset) void setBrowserViewport(preset.viewport).catch(() => {})
  }, [status, viewportChoice])

  useEffect(
    () =>
      subscribeBrowserEvents({
        // Frames bypass React state: writing the data URL straight to the image
        // avoids a full component re-render at frame rate.
        onFrame: (data) => {
          const image = frameImageRef.current
          if (image) image.src = `data:image/jpeg;base64,${data}`
          setHasFrame((current) => current || true)
        },
        onUrl: onUrlCommit,
        onStatus: (next) => {
          setStatus(next)
          if (next.state !== 'live') setHasFrame(false)
        },
      }),
    [onUrlCommit],
  )

  function navigate(event: FormEvent): void {
    event.preventDefault()
    const next = normalizeBrowserUrl(address)
    if (!next) {
      setAddress(url)
      return
    }
    if (next === url) setReloadNonce((current) => current + 1)
    onUrlCommit(next)
    if (live) void navigateBrowser(next).catch(() => {})
  }

  function reload(): void {
    if (!url) return
    if (live) void navigateBrowser(url).catch(() => {})
    else setReloadNonce((current) => current + 1)
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

  function buttonName(button: number): 'left' | 'middle' | 'right' {
    return button === 1 ? 'middle' : button === 2 ? 'right' : 'left'
  }

  function dispatchMouse(
    event: ReactPointerEvent<HTMLImageElement>,
    type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
  ): void {
    if (!live) return
    const { x, y } = pageCoordinates(event)
    sendBrowserInput({
      type,
      x,
      y,
      button: type === 'mouseMoved' && event.buttons === 0 ? 'none' : buttonName(event.button),
      clickCount: type === 'mouseMoved' ? 0 : event.detail || 1,
      modifiers: cdpModifiers(event),
    })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLImageElement>): void {
    if (!live) return
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
    if (!live) return
    const now = performance.now()
    if (now - lastMoveSentRef.current < 32) return
    lastMoveSentRef.current = now
    dispatchMouse(event, 'mouseMoved')
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLImageElement>): void {
    if (!live) return
    dispatchMouse(event, 'mouseReleased')
  }

  function handleWheelEvent(element: HTMLDivElement | null): void {
    if (!element) return
    element.addEventListener(
      'wheel',
      (nativeEvent) => {
        if (!liveRef.current) return
        nativeEvent.preventDefault()
        const image = frameImageRef.current
        if (!image) return
        const { x, y } = mapPointerToPage(nativeEvent, {
          rect: image.getBoundingClientRect(),
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        })
        // Coalesce bursts: one dispatch per tick instead of one per DOM event,
        // so fast scrolling does not queue a wall of wheel commands.
        pendingWheel.x = x
        pendingWheel.y = y
        pendingWheel.deltaX += nativeEvent.deltaX
        pendingWheel.deltaY += nativeEvent.deltaY
        if (wheelFlushTimer !== null) return
        wheelFlushTimer = window.setTimeout(() => {
          wheelFlushTimer = null
          sendBrowserInput({
            type: 'mouseWheel',
            x: pendingWheel.x,
            y: pendingWheel.y,
            deltaX: pendingWheel.deltaX,
            deltaY: pendingWheel.deltaY,
            modifiers: 0,
          })
          pendingWheel.deltaX = 0
          pendingWheel.deltaY = 0
        }, wheelFlushIntervalMs)
      },
      { passive: false },
    )
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (!live) return
    if (event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const common = {
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      modifiers: cdpModifiers(event),
    }
    if (event.key.length === 1) {
      sendBrowserInput({ ...common, type: 'keyDown', text: event.key })
      sendBrowserInput({ ...common, type: 'keyUp' })
      return
    }
    sendBrowserInput({ ...common, type: 'keyDown' })
    sendBrowserInput({ ...common, type: 'keyUp' })
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>): void {
    if (!live || !event.data) return
    sendBrowserInput({ type: 'insertText', text: event.data })
  }

  return (
    <div aria-label='Browser' className='browser-view'>
      <form className='browser-bar' onSubmit={navigate}>
        <select
          aria-label='Browser viewport size'
          className='browser-bar-select'
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
          onChange={(event) => setZoomMode(event.target.value === 'natural' ? 'natural' : 'auto')}
          title='Frame zoom'
          value={zoomMode}
        >
          <option value='auto'>Auto</option>
          <option value='natural'>100%</option>
        </select>
        {zoomMode === 'auto' && <span className='browser-zoom-value'>{zoomPercent}%</span>}
        <input
          onChange={(event) => setAddress(event.target.value)}
          placeholder='Enter address — e.g. localhost:3000'
          spellCheck={false}
          type='text'
          value={address}
        />
        <button
          aria-label='Reload page'
          className='browser-reload'
          disabled={!url}
          onClick={reload}
          type='button'
        >
          ↻
        </button>
        {url && (
          <a
            aria-label='Open in new window'
            className='browser-external'
            href={url}
            rel='noreferrer'
            target='_blank'
          >
            ↗
          </a>
        )}
        <button
          className={`browser-live-toggle${live ? ' active' : ''}`}
          onClick={() => {
            if (live) void stopBrowserSession().catch(() => {})
            else void startBrowserSession().catch(() => {})
          }}
          type='button'
        >
          {live ? 'Stop' : status.state === 'starting' ? 'Starting…' : 'Go live'}
        </button>
      </form>
      {status.state === 'crashed' && status.error && (
        <p className='browser-session-error' role='alert'>
          {status
            .error}
        </p>
      )}
      {live
        ? (
          <>
            <div
              className={`browser-live${zoomMode === 'natural' ? ' natural' : ''}`}
              onCompositionEnd={handleCompositionEnd}
              onKeyDown={handleKeyDown}
              ref={handleWheelEvent}
              tabIndex={0}
            >
              {hasFrame
                ? (
                  <img
                    alt='Live browser view'
                    className='browser-frame'
                    decoding='async'
                    draggable={false}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    ref={frameImageRef}
                    src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
                  />
                )
                : <p className='browser-hint'>Waiting for the live browser…</p>}
              <input
                aria-hidden='true'
                className='browser-compose'
                ref={composeInputRef}
                tabIndex={-1}
                type='text'
              />
            </div>
            <div className='browser-attach'>
              <span>Attach browser tooling</span>
              <code>{status.endpoint}</code>
              <button
                onClick={() =>
                  void navigator.clipboard?.writeText(status.endpoint ?? '').catch(() => {})}
                type='button'
              >
                Copy
              </button>
            </div>
          </>
        )
        : url
        ? (
          <iframe
            className='browser-frame browser-frame-iframe'
            key={`${url}#${reloadNonce}`}
            sandbox='allow-forms allow-same-origin allow-scripts'
            src={url}
            title={`Browser view of ${url}`}
          />
        )
        : (
          <p className='browser-hint'>
            Enter an address above to browse, or press “Go live” to share a real browser with your
            agent. Local development servers (for example{' '}
            <code>localhost:3000</code>) work in both modes; frame-refusing sites need the live
            browser.
          </p>
        )}
    </div>
  )
}
