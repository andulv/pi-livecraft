# Browser instances

Owns workspace-scoped livecast browsers. Each browser instance is one isolated headless
Chrome whose CDP endpoint is the tool-neutral attachment boundary for agent browser
tooling (Chrome DevTools MCP, Playwright, Puppeteer, or raw CDP). See the
[bridge specification](/docs/BROWSER-BRIDGE.md) for the full contract.

- `chrome-launcher.ts` resolves the browser binary (`PI_LIVECRAFT_BROWSER_BIN`
  overrides, then platform candidates), spawns it with a dynamic
  `--remote-debugging-port` and a temporary user-data-dir, and parses the DevTools
  endpoint from stderr. The HTTP endpoint for attachment is derived from the printed
  WebSocket URL; note that `new URL(ws).origin` keeps the `ws:` scheme and must not
  be used. The window size must equal the screencast capture cap — input coordinates
  map 1:1 between the captured frame and the viewport. Launch flags come from the
  pure `chromeLaunchArgs()`: they keep scrollbars visible and disable
  `AutomationControlled`, and `browser-session.ts` additionally strips the
  `Headless` token from the user agent and hides `navigator.webdriver`, so casual
  bot filters do not lock the browser out (determined ones still may).
- `cdp-client.ts` is a minimal CDP JSON-RPC client over Node's built-in `WebSocket`
  (no new dependencies) with injectable transports for tests. Commands correlate by
  id with timeouts; events fan out to subscribers.
- `browser-service.ts` owns `Map<canonical workspace path, Map<browser ID, BrowserSession>>`.
  It keeps instance lookup stable, groups installation-wide diagnostics, and cleans up
  every registered Chrome on backend exit. `browser-session.ts` orchestrates one
  instance lifecycle (`off | starting | live | stopped |
  crashed`), subscribes to `Page.startScreencast` frames (acking with the frame's
  session id — Chrome may report it as a number, and un-acked casts are throttled to
  a stop), forwards validated input events to `Input.*`, and emits frame/url/status
  events to SSE subscribers. Its diagnostics snapshot opens a short-lived connection
  to the browser-level CDP target for `SystemInfo.getProcessInfo`; it also reports the
  root PID, temporary profile, viewer count, and capture counters without starting a
  screencast viewer.

Routes live in `server/backend.ts`. Instance operations use
`/api/browser/instances/:browserId/*` plus a validated `workspacePath`; the aggregate
`GET /api/browser/debug` response groups all instances by workspace. The debug port binds
127.0.0.1 only and uses a fresh profile per browser instance; any local process can reach it,
which matches the app's local trust model. Focused coverage: `test/browser-launcher.test.ts`,
`test/browser-cdp-client.test.ts`, `test/browser-debug.test.ts`,
`test/browser-service.test.ts`, `test/browser-input.test.ts`, and the gated
`test/browser-smoke.test.ts` (runs when a browser binary is found, skipped otherwise).
