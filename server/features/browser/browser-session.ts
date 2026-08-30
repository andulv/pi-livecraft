import type {
  BrowserInputEvent,
  BrowserSessionState,
  BrowserSessionStatus,
  JsonObject,
} from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import { CdpConnection, CdpError } from './cdp-client.ts'
import {
  BrowserLaunchError,
  launchHeadlessChrome,
  type LaunchedBrowser,
} from './chrome-launcher.ts'

const screencastParams: JsonObject = {
  format: 'jpeg',
  quality: 70,
  maxWidth: 1600,
  maxHeight: 1100,
  everyNthFrame: 1,
}

export type BrowserSessionEvent =
  | { type: 'frame'; data: string }
  | { type: 'url'; url: string }
  | { type: 'status'; status: BrowserSessionStatus }

/** Maps a validated input event to its CDP command. Pure; unit-tested. */
export function cdpInputCommand(event: BrowserInputEvent): {
  method: string
  params: JsonObject
} {
  switch (event.type) {
    case 'mouseMoved':
    case 'mousePressed':
    case 'mouseReleased':
      return {
        method: 'Input.dispatchMouseEvent',
        params: {
          type: event.type === 'mouseMoved' ? 'mouseMoved' : event.type,
          x: event.x,
          y: event.y,
          button: event.button,
          buttons: event.type === 'mouseMoved' ? (event.button === 'none' ? 0 : 1) : 0,
          clickCount: event.clickCount,
          modifiers: event.modifiers,
        },
      }
    case 'mouseWheel':
      return {
        method: 'Input.dispatchMouseEvent',
        params: {
          type: 'mouseWheel',
          x: event.x,
          y: event.y,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          modifiers: event.modifiers,
        },
      }
    case 'keyDown':
      return {
        method: 'Input.dispatchKeyEvent',
        params: {
          type: event.text === undefined ? 'rawKeyDown' : 'keyDown',
          key: event.key,
          code: event.code,
          windowsVirtualKeyCode: event.keyCode,
          nativeVirtualKeyCode: event.keyCode,
          modifiers: event.modifiers,
          ...(event.text === undefined ? {} : { text: event.text, unmodifiedText: event.text }),
        },
      }
    case 'keyUp':
      return {
        method: 'Input.dispatchKeyEvent',
        params: {
          type: 'keyUp',
          key: event.key,
          code: event.code,
          windowsVirtualKeyCode: event.keyCode,
          nativeVirtualKeyCode: event.keyCode,
          modifiers: event.modifiers,
        },
      }
    case 'insertText':
      return { method: 'Input.insertText', params: { text: event.text } }
  }
}

const mouseButtons = ['none', 'left', 'middle', 'right', 'back', 'forward'] as const
type MouseButtonType = (typeof mouseButtons)[number]

/** Validates an untrusted input payload into a BrowserInputEvent. */
export function parseBrowserInputEvent(value: unknown): BrowserInputEvent | null {
  if (!isObject(value) || typeof value.type !== 'string') return null
  const { type } = value
  const modifiers = numberOr(value.modifiers, 0)
  if (
    type === 'mouseMoved' || type === 'mousePressed' || type === 'mouseReleased'
  ) {
    if (
      !isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.clickCount)
      || typeof value.button !== 'string'
      || !mouseButtons.includes(value.button as MouseButtonType)
    ) return null
    return {
      type,
      x: value.x,
      y: value.y,
      button: value.button as MouseButtonType,
      clickCount: Math.max(1, Math.min(3, Math.round(value.clickCount))),
      modifiers,
    }
  }
  if (type === 'mouseWheel') {
    if (
      !isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.deltaX)
      || !isFiniteNumber(value.deltaY)
    ) return null
    return {
      type,
      x: value.x,
      y: value.y,
      deltaX: value.deltaX,
      deltaY: value.deltaY,
      modifiers,
    }
  }
  if (type === 'keyDown' || type === 'keyUp') {
    if (typeof value.key !== 'string' || typeof value.code !== 'string') return null
    const text = typeof value.text === 'string' ? value.text : undefined
    if (text !== undefined && text.length > 1) return null
    return {
      type,
      key: value.key,
      code: value.code,
      keyCode: numberOr(value.keyCode, 0),
      modifiers,
      ...(text === undefined ? {} : { text }),
    }
  }
  if (type === 'insertText') {
    if (typeof value.text !== 'string' || value.text.length === 0 || value.text.length > 1_000) {
      return null
    }
    return { type, text: value.text }
  }
  return null
}

function numberOr(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Owns the shared Chrome instance, its CDP connection, and pane event fan-out. */
export class BrowserSession {
  #state: BrowserSessionState = 'off'
  #error: string | undefined
  #url: string | undefined
  #endpoint: string | undefined
  #browser: LaunchedBrowser | null = null
  #cdp: CdpConnection | null = null
  #subscribers = new Set<(event: BrowserSessionEvent) => void>()
  #startPromise: Promise<BrowserSessionStatus> | null = null

  status(): BrowserSessionStatus {
    return { state: this.#state, url: this.#url, endpoint: this.#endpoint, error: this.#error }
  }

  subscribe(listener: (event: BrowserSessionEvent) => void): () => void {
    this.#subscribers.add(listener)
    return () => this.#subscribers.delete(listener)
  }

  /** Starts (or returns) the shared browser; safe to call concurrently. */
  start(): Promise<BrowserSessionStatus> {
    if (this.#state === 'live') return Promise.resolve(this.status())
    if (this.#startPromise) return this.#startPromise
    this.#startPromise = this.#start().finally(() => {
      this.#startPromise = null
    })
    return this.#startPromise
  }

  async #start(): Promise<BrowserSessionStatus> {
    this.#setState({ state: 'starting' })
    try {
      const browser = await launchHeadlessChrome({})
      this.#browser = browser
      this.#endpoint = browser.httpEndpoint
      const pageTarget = await findOrCreatePage(browser.httpEndpoint)
      const cdp = new CdpConnection()
      await cdp.connect(pageTarget)
      this.#cdp = cdp
      cdp.onDisconnected(() => {
        if (this.#cdp === cdp && this.#state === 'live') {
          this.#setState({ state: 'crashed', error: 'The browser connection was lost' })
        }
      })
      browser.child.once('exit', () => {
        if (this.#browser === browser && this.#state !== 'stopped') {
          this.#setState({ state: 'crashed', error: 'The browser exited unexpectedly' })
        }
      })
      cdp.on('Page.screencastFrame', (params) => {
        if (typeof params.data === 'string') this.#emit({ type: 'frame', data: params.data })
        // Chrome reports the screencast session id as a number or a string
        // depending on version; un-acked casts are throttled to a stop.
        const screencastSession = params.sessionId
        if (
          typeof screencastSession === 'string' || typeof screencastSession === 'number'
        ) {
          void cdp
            .send('Page.screencastFrameAck', { sessionId: screencastSession })
            .catch(() => {})
        }
      })
      cdp.on('Page.frameNavigated', (params) => {
        const frame = isObject(params.frame) ? params.frame : null
        if (frame && frame.parentId === undefined && typeof frame.url === 'string') {
          this.#url = frame.url
          this.#emit({ type: 'url', url: frame.url })
        }
      })
      await cdp.send('Page.enable')
      this.#url = await currentPageUrl(cdp)
      await cdp.send('Page.startScreencast', screencastParams)
      this.#setState({ state: 'live' })
      return this.status()
    } catch (error) {
      await this.#teardown()
      const message = error instanceof BrowserLaunchError || error instanceof CdpError
        ? error.message
        : error instanceof Error
        ? error.message
        : String(error)
      this.#setState({ state: 'crashed', error: message })
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.#state === 'off') return
    await this.#teardown()
    this.#setState({ state: 'stopped' })
  }

  /** Synchronous last-resort cleanup for process exit. */
  killSync(): void {
    const child = this.#browser?.child
    if (child && child.exitCode === null && !child.killed) child.kill('SIGKILL')
  }

  async navigate(url: string): Promise<void> {
    if (this.#state !== 'live' || !this.#cdp) throw new Error('The browser session is not live')
    await this.#cdp.send('Page.navigate', { url })
  }

  async dispatchInput(event: BrowserInputEvent): Promise<void> {
    if (this.#state !== 'live' || !this.#cdp) throw new Error('The browser session is not live')
    const { method, params } = cdpInputCommand(event)
    await this.#cdp.send(method, params)
  }

  async #teardown(): Promise<void> {
    this.#cdp?.close()
    this.#cdp = null
    const browser = this.#browser
    this.#browser = null
    await browser?.cleanup()
  }

  #setState(partial: { state: BrowserSessionState; error?: string }): void {
    this.#state = partial.state
    this.#error = partial.error
    if (partial.state === 'off' || partial.state === 'stopped') this.#endpoint = undefined
    this.#emit({ type: 'status', status: this.status() })
  }

  #emit(event: BrowserSessionEvent): void {
    for (const subscriber of this.#subscribers) subscriber(event)
  }
}

/** Finds an existing page target or creates one via the DevTools HTTP endpoint. */
async function findOrCreatePage(httpEndpoint: string): Promise<string> {
  const list = await fetchJson(`${httpEndpoint}/json/list`)
  if (Array.isArray(list)) {
    const page = list.find(
      (target: unknown) =>
        isObject(target) && target.type === 'page'
        && typeof target.webSocketDebuggerUrl === 'string',
    )
    if (page && isObject(page) && typeof page.webSocketDebuggerUrl === 'string') {
      return page.webSocketDebuggerUrl
    }
  }
  const created = await fetch(`${httpEndpoint}/json/new`, { method: 'PUT' })
  const value: unknown = await created.json()
  if (!isObject(value) || typeof value.webSocketDebuggerUrl !== 'string') {
    throw new Error('The browser did not provide a page target')
  }
  return value.webSocketDebuggerUrl
}

async function currentPageUrl(cdp: CdpConnection): Promise<string | undefined> {
  const history = await cdp.send('Page.getNavigationHistory')
  const entries = Array.isArray(history.entries) ? history.entries : []
  const index = typeof history.currentIndex === 'number' ? history.currentIndex : entries.length - 1
  const entry = entries[index]
  return isObject(entry) && typeof entry.url === 'string' ? entry.url : undefined
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  return response.json()
}
