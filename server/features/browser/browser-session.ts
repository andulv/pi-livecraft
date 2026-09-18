import type {
  BrowserDebugSnapshot,
  BrowserInputEvent,
  BrowserProcessInfo,
  BrowserSessionState,
  BrowserSessionStatus,
  BrowserViewport,
  JsonObject,
} from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import { CdpConnection, CdpError } from './cdp-client.ts'
import {
  BrowserLaunchError,
  acquireDebugPort,
  launchHeadlessChrome,
  type LaunchedBrowser,
} from './chrome-launcher.ts'

const defaultViewport: BrowserViewport = { width: 1280, height: 900, mobile: false }

/** Validated bounds for an emulated viewport. */
export function parseBrowserViewport(value: unknown): BrowserViewport | null {
  if (!isObject(value)) return null
  const width = value.width
  const height = value.height
  if (
    !isFiniteNumber(width) || !isFiniteNumber(height)
    || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 200 || width > 3840 || height < 320 || height > 4320
  ) return null
  return { width, height, mobile: value.mobile === true }
}

function screencastParamsFor(viewport: BrowserViewport): JsonObject {
  return {
    format: 'jpeg',
    quality: 60,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
    maxFrameRate: 12,
  }
}

/** Minimum spacing between screencast acks; pacing acks caps Chrome's encode rate. */
const minAckIntervalMs = 80

export type BrowserSessionEvent =
  | { type: 'frame'; data: string }
  | { type: 'url'; url: string }
  | { type: 'status'; status: BrowserSessionStatus }

/** Serializes one session event into its SSE event name and JSON payload. Pure. */
export function wireFor(event: BrowserSessionEvent): { name: string; json: string } {
  if (event.type === 'frame') return { name: 'frame', json: JSON.stringify({ data: event.data }) }
  if (event.type === 'url') return { name: 'url', json: JSON.stringify({ url: event.url }) }
  return { name: 'status', json: JSON.stringify(event.status) }
}

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
      clickCount: Math.max(0, Math.min(3, Math.round(value.clickCount))),
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
    if (typeof value.text !== 'string' || value.text.length === 0 || value.text.length > 10_000) {
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

/** Normalizes Chrome's browser-level process report for the diagnostics API. */
export function parseBrowserProcessInfo(value: unknown): BrowserProcessInfo[] {
  if (!Array.isArray(value)) return []
  const processes: BrowserProcessInfo[] = []
  for (const item of value) {
    if (!isObject(item)) continue
    const pid = item.id
    const type = item.type
    const cpuTimeSeconds = item.cpuTime
    if (
      typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0
      || typeof type !== 'string' || !type
      || !isFiniteNumber(cpuTimeSeconds) || cpuTimeSeconds < 0
    ) continue
    processes.push({ pid, type, cpuTimeSeconds })
  }
  return processes.sort((left, right) => {
    if (left.type === 'browser' && right.type !== 'browser') return -1
    if (right.type === 'browser' && left.type !== 'browser') return 1
    return left.pid - right.pid
  })
}

/** Owns one Chrome instance, its CDP connection, and pane event fan-out. */
export class BrowserSession {
  #state: BrowserSessionState = 'off'
  #error: string | undefined
  #url: string | undefined
  #endpoint: string | undefined
  #browser: LaunchedBrowser | null = null
  #cdp: CdpConnection | null = null
  #subscribers = new Set<(event: string, json: string) => void>()
  #startPromise: Promise<BrowserSessionStatus> | null = null
  #viewers = 0
  #startedAt: number | undefined
  #capturedFrames = 0
  #capturedBytes = 0
  #lastAckAt = 0
  #ackTimer: ReturnType<typeof setTimeout> | null = null
  #pendingAckSession: number | string | null = null
  #viewport: BrowserViewport = { ...defaultViewport }
  readonly #debugPortBase: number | undefined

  constructor(options: { debugPortBase?: number } = {}) {
    this.#debugPortBase = options.debugPortBase
  }

  status(): BrowserSessionStatus {
    return {
      state: this.#state,
      url: this.#url,
      endpoint: this.#endpoint,
      error: this.#error,
      viewport: { ...this.#viewport },
    }
  }

  /** Samples process and stream diagnostics without changing the browser session. */
  async debugSnapshot(): Promise<BrowserDebugSnapshot> {
    const browser = this.#browser
    let processes: BrowserProcessInfo[] = []
    let processError: string | undefined
    const browserRunning = browser && browser.child.exitCode === null && !browser.child.killed
    if (browserRunning) {
      const diagnostics = new CdpConnection()
      try {
        await diagnostics.connect(browser.wsEndpoint, 2_000)
        const result = await diagnostics.send('SystemInfo.getProcessInfo', {}, 2_000)
        processes = parseBrowserProcessInfo(result.processInfo)
      } catch (error) {
        processError = error instanceof Error ? error.message : String(error)
      } finally {
        diagnostics.close()
      }
    }
    const currentBrowser = this.#browser === browser
        && browser?.child.exitCode === null && !browser.child.killed
      ? browser
      : null
    return {
      status: this.status(),
      sampledAt: Date.now(),
      rootPid: currentBrowser?.child.pid,
      startedAt: currentBrowser ? this.#startedAt : undefined,
      viewerCount: this.#viewers,
      capturedFrames: this.#capturedFrames,
      capturedBytes: this.#capturedBytes,
      profilePath: currentBrowser?.userDataDir,
      processes: currentBrowser ? processes : [],
      processError: currentBrowser ? processError : undefined,
    }
  }

  /** Emulates a device viewport and recaptures at the matching size. */
  async setViewport(viewport: BrowserViewport): Promise<void> {
    this.#viewport = { ...viewport }
    const cdp = this.#cdp
    if (this.#state !== 'live' || !cdp) {
      this.#emit({ type: 'status', status: this.status() })
      return
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    })
    this.#clearPendingAck()
    await cdp.send('Page.stopScreencast').catch(() => {})
    if (this.#viewers > 0) {
      await cdp.send('Page.startScreencast', screencastParamsFor(this.#viewport))
    }
    this.#emit({ type: 'status', status: this.status() })
  }

  subscribe(listener: (event: string, json: string) => void): () => void {
    this.#subscribers.add(listener)
    return () => this.#subscribers.delete(listener)
  }

  /** Registers an active frame consumer; the screencast pauses while none remain. */
  addViewer(): void {
    this.#viewers++
    if (this.#viewers === 1 && this.#state === 'live') {
      void this.#cdp?.send('Page.startScreencast', screencastParamsFor(this.#viewport)).catch(
        () => {},
      )
    }
  }

  releaseViewer(): void {
    if (this.#viewers > 0) this.#viewers--
    if (this.#viewers === 0 && this.#state === 'live') {
      this.#clearPendingAck()
      void this.#cdp?.send('Page.stopScreencast').catch(() => {})
    }
  }

  #clearPendingAck(): void {
    if (this.#ackTimer) clearTimeout(this.#ackTimer)
    this.#ackTimer = null
    this.#pendingAckSession = null
  }

  #paceScreencastAck(sessionId: number | string): void {
    this.#pendingAckSession = sessionId
    const elapsed = Date.now() - this.#lastAckAt
    if (elapsed >= minAckIntervalMs) {
      if (this.#ackTimer) clearTimeout(this.#ackTimer)
      this.#ackTimer = null
      this.#sendPendingAck()
      return
    }
    if (this.#ackTimer) return
    this.#ackTimer = setTimeout(() => {
      this.#ackTimer = null
      this.#sendPendingAck()
    }, minAckIntervalMs - elapsed)
  }

  #sendPendingAck(): void {
    this.#lastAckAt = Date.now()
    const pending = this.#pendingAckSession
    this.#pendingAckSession = null
    if (pending !== null) {
      void this.#cdp?.send('Page.screencastFrameAck', { sessionId: pending }).catch(() => {})
    }
  }

  /** Starts (or returns) this browser instance; safe to call concurrently. */
  start(): Promise<BrowserSessionStatus> {
    if (this.#state === 'live') return Promise.resolve(this.status())
    if (this.#startPromise) return this.#startPromise
    this.#startPromise = this.#start().finally(() => {
      this.#startPromise = null
    })
    return this.#startPromise
  }

  async #start(): Promise<BrowserSessionStatus> {
    this.#capturedFrames = 0
    this.#capturedBytes = 0
    this.#startedAt = undefined
    this.#setState({ state: 'starting' })
    try {
      // The deterministic base keeps a workspace's endpoint stable across
      // restarts; the bounded scan only drifts it under a port collision.
      const debugPort = this.#debugPortBase === undefined
        ? undefined
        : await acquireDebugPort(this.#debugPortBase)
      const browser = await launchHeadlessChrome({ debugPort })
      this.#browser = browser
      this.#startedAt = Date.now()
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
        if (typeof params.data === 'string') {
          this.#capturedFrames++
          this.#capturedBytes += Buffer.byteLength(params.data, 'base64')
          this.#emit({ type: 'frame', data: params.data })
        }
        // Chrome reports the screencast session id as a number or a string
        // depending on version; un-acked casts are throttled to a stop, while
        // instantly acking every frame lets Chrome encode at full compositor
        // speed — so acks are paced and always reference the latest frame.
        const screencastSession = params.sessionId
        if (
          typeof screencastSession === 'string' || typeof screencastSession === 'number'
        ) {
          this.#paceScreencastAck(screencastSession)
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
      await this.#appearAsNormalChrome(cdp)
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: this.#viewport.width,
        height: this.#viewport.height,
        deviceScaleFactor: 1,
        mobile: this.#viewport.mobile,
      })
      this.#url = await currentPageUrl(cdp)
      if (this.#viewers > 0) {
        await cdp.send('Page.startScreencast', screencastParamsFor(this.#viewport))
      }
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

  /** Stops the shared browser; existing viewers reconnect to a stopped state. */
  async stop(): Promise<void> {
    if (this.#state === 'off') return
    await this.#teardown()
    this.#setState({ state: 'stopped' })
  }

  /**
   * Strips the cheap headless tells from the page fingerprint: the UA token,
   * which is read from the live page so the real version number is kept, and
   * navigator.webdriver. Best effort — a session must still start if Chrome
   * rejects one of the overrides.
   */
  async #appearAsNormalChrome(cdp: CdpConnection): Promise<void> {
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: 'navigator.userAgent',
      returnByValue: true,
    })
    const reported = isObject(evaluated.result) ? evaluated.result.value : undefined
    const userAgent = typeof reported === 'string' && reported.includes('HeadlessChrome')
      ? reported.replace('HeadlessChrome', 'Chrome')
      : undefined
    if (userAgent) {
      await cdp.send('Emulation.setUserAgentOverride', { userAgent }).catch(() => {})
    }
    await cdp
      .send('Page.addScriptToEvaluateOnNewDocument', {
        source: 'Object.defineProperty(navigator, "webdriver", { get: () => false })',
      })
      .catch(() => {})
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

  async reload(): Promise<void> {
    if (this.#state !== 'live' || !this.#cdp) throw new Error('The browser session is not live')
    await this.#cdp.send('Page.reload')
  }

  async dispatchInput(event: BrowserInputEvent): Promise<void> {
    if (this.#state !== 'live' || !this.#cdp) throw new Error('The browser session is not live')
    const { method, params } = cdpInputCommand(event)
    await this.#cdp.send(method, params)
  }

  async #teardown(): Promise<void> {
    this.#clearPendingAck()
    this.#cdp?.close()
    this.#cdp = null
    const browser = this.#browser
    this.#browser = null
    await browser?.cleanup()
    this.#startedAt = undefined
  }

  #setState(partial: { state: BrowserSessionState; error?: string }): void {
    this.#state = partial.state
    this.#error = partial.error
    if (partial.state === 'off' || partial.state === 'stopped') this.#endpoint = undefined
    this.#emit({ type: 'status', status: this.status() })
  }

  #emit(event: BrowserSessionEvent): void {
    if (this.#subscribers.size === 0) return
    // Serialized once per event so every SSE viewer writes the same bytes.
    const { name, json } = wireFor(event)
    for (const subscriber of this.#subscribers) subscriber(name, json)
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
