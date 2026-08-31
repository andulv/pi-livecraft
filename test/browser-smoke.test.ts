import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserSession } from '../server/features/browser/browser-session.ts'
import { CdpConnection } from '../server/features/browser/cdp-client.ts'
import { resolveBrowserBinary } from '../server/features/browser/chrome-launcher.ts'

const pageHtml = `<!doctype html><html><body style="margin:0">
<button id="b" onclick="document.getElementById('s').textContent='ON'"
  style="position:fixed;left:20px;top:20px;width:120px;height:60px">go</button>
<span id="s" style="position:fixed;left:20px;top:100px">OFF</span>
</body></html>`
const pageUrl = `data:text/html,${encodeURIComponent(pageHtml)}`

const hasBrowser = await resolveBrowserBinary(process.env, process.platform).then(
  () => true,
  () => false,
)

test(
  'streams frames, forwards input, and survives a second CDP client',
  {
    timeout: 30_000,
    skip: hasBrowser ? false : 'No Chrome/Chromium binary found; set PI_LIVECRAFT_BROWSER_BIN',
  },
  async () => {
    const session = new BrowserSession()
    test.after(() => void session.stop())

    const frames: string[] = []
    const urls: string[] = []
    session.subscribe((event) => {
      if (event.type === 'frame') frames.push(event.data)
      else if (event.type === 'url') urls.push(event.url)
    })

    const status = await session.start()
    assert.equal(status.state, 'live')
    assert.ok(status.endpoint?.startsWith('http://127.0.0.1:'))

    await session.navigate(pageUrl)
    await waitFor(() => urls.some((url) => url.startsWith('data:text/html')))
    await waitFor(() => frames.length > 0)

    const diagnostics = await session.debugSnapshot()
    assert.equal(diagnostics.status.state, 'live')
    assert.ok(diagnostics.rootPid && diagnostics.rootPid > 0)
    assert.ok(diagnostics.processes.some((process) => process.type === 'browser'))
    assert.ok(diagnostics.capturedFrames > 0)
    assert.ok(diagnostics.capturedBytes > 0)

    // A second, independent CDP client — the tool-neutral agent attachment path.
    const pages = await fetch(`${status.endpoint}/json/list`).then((response) => response.json())
    const page = (pages as Array<Record<string, unknown>>).find(
      (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
    )
    assert.ok(page, 'Expected a page target for the second client')
    const agent = new CdpConnection()
    await agent.connect(page.webSocketDebuggerUrl as string)
    await agent.send('Runtime.enable')

    // The agent navigates while the pane screencast keeps flowing (coexistence).
    await agent.send('Page.navigate', { url: 'about:blank' })
    await waitFor(() => urls.includes('about:blank'))
    const framesAtAgentNavigation = frames.length
    await agent.send('Page.navigate', { url: pageUrl })
    await waitFor(() => urls.filter((url) => url.startsWith('data:text/html')).length >= 2)
    await waitFor(() => frames.length > framesAtAgentNavigation)
    await waitFor(() => evaluateBoolean(agent, '!!document.getElementById(\'b\')'))

    // Human input from the pane: click the button through the shared session.
    await session.dispatchInput({
      type: 'mouseMoved',
      x: 80,
      y: 50,
      button: 'none',
      clickCount: 1,
      modifiers: 0,
    })
    await session.dispatchInput({
      type: 'mousePressed',
      x: 80,
      y: 50,
      button: 'left',
      clickCount: 1,
      modifiers: 0,
    })
    await session.dispatchInput({
      type: 'mouseReleased',
      x: 80,
      y: 50,
      button: 'left',
      clickCount: 1,
      modifiers: 0,
    })
    await waitFor(() =>
      evaluateBoolean(agent, 'document.getElementById(\'s\').textContent === \'ON\'')
    )

    agent.close()
    await session.stop()
    assert.equal(session.status().state, 'stopped')
  },
)

async function evaluateBoolean(agent: CdpConnection, expression: string): Promise<boolean> {
  const response = await agent.send('Runtime.evaluate', { expression, returnByValue: true })
  return (response.result as { value?: unknown } | undefined)?.value === true
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the browser session')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
