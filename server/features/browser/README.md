# Browser session

Owns the shared livecast browser: one isolated headless Chrome whose CDP endpoint is
the tool-neutral attachment boundary for agent browser tooling (Chrome DevTools MCP,
Playwright, Puppeteer, or raw CDP — any client that attaches instead of launching its
own browser). See [the bridge specification](/docs/BROWSER-BRIDGE.md) for the full
contract.

- `chrome-launcher.ts` resolves the browser binary (`PI_LIVECRAFT_BROWSER_BIN`
  overrides, then platform candidates), spawns it with a dynamic
  `--remote-debugging-port` and a temporary user-data-dir, and parses the DevTools
  endpoint from stderr. The HTTP endpoint for attachment is derived from the printed
  WebSocket URL; note that `new URL(ws).origin` keeps the `ws:` scheme and must not
  be used. The window size must equal the screencast capture cap — input coordinates
  map 1:1 between the captured frame and the viewport.
- `cdp-client.ts` is a minimal CDP JSON-RPC client over Node's built-in `WebSocket`
  (no new dependencies) with injectable transports for tests. Commands correlate by
  id with timeouts; events fan out to subscribers.
- `browser-session.ts` orchestrates the lifecycle (`off | starting | live | stopped |
  crashed`), subscribes to `Page.startScreencast` frames (acking with the frame's
  session id — Chrome may report it as a number, and un-acked casts are throttled to
  a stop), forwards validated input events to `Input.*`, and emits frame/url/status
  events to SSE subscribers.

Routes live in `server/backend.ts` (`/api/browser/*`). The debug port binds
127.0.0.1 only and uses a fresh profile per session; any local process can reach it,
which matches the app's local trust model. Focused coverage: `test/browser-launcher.test.ts`,
`test/browser-cdp-client.test.ts`, `test/browser-input.test.ts`, and the gated
`test/browser-smoke.test.ts` (runs when a browser binary is found, skipped otherwise).
