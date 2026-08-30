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
  startBrowserSession,
  stopBrowserSession,
  subscribeBrowserEvents,
} from '../../api.ts'
import type { BrowserSessionStatus } from '../../../shared/types.ts'
import { normalizeBrowserUrl } from './browser-url.ts'
import { cdpModifiers, mapPointerToPage } from './coordinates.ts'

/** Human-driven browser surface: an address bar, a livecast view, and an iframe fallback. */
export function BrowserView({ onUrlCommit, url }: {
  onUrlCommit: (url: string) => void
  url: string
}) {
  const [address, setAddress] = useState(url)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [status, setStatus] = useState<BrowserSessionStatus>({ state: 'off' })
  const [frame, setFrame] = useState<string | null>(null)
  const frameImageRef = useRef<HTMLImageElement>(null)
  const composeInputRef = useRef<HTMLInputElement>(null)
  const liveRef = useRef(false)
  const lastMoveSentRef = useRef(0)
  const live = status.state === 'live'
  liveRef.current = live

  useEffect(() => setAddress(url), [url])

  useEffect(
    () =>
      subscribeBrowserEvents({
        onFrame: setFrame,
        onUrl: onUrlCommit,
        onStatus: (next) => {
          setStatus(next)
          if (next.state !== 'live') setFrame(null)
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
    event.currentTarget.setPointerCapture(event.pointerId)
    composeInputRef.current?.focus()
    dispatchMouse(event, 'mousePressed')
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLImageElement>): void {
    if (!live) return
    const now = performance.now()
    if (now - lastMoveSentRef.current < 16) return
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
        sendBrowserInput({
          type: 'mouseWheel',
          x,
          y,
          deltaX: nativeEvent.deltaX,
          deltaY: nativeEvent.deltaY,
          modifiers: cdpModifiers(nativeEvent),
        })
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
              className='browser-live'
              ref={handleWheelEvent}
              tabIndex={0}
            >
              {frame
                ? (
                  <img
                    alt='Live browser view'
                    className='browser-frame'
                    draggable={false}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    ref={frameImageRef}
                    src={`data:image/jpeg;base64,${frame}`}
                  />
                )
                : <p className='browser-hint'>Waiting for the live browser…</p>}
              <input
                aria-hidden='true'
                className='browser-compose'
                onCompositionEnd={handleCompositionEnd}
                onKeyDown={handleKeyDown}
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
