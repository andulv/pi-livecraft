# Browser

`BrowserView.tsx` renders the viewer pane's Browser tab as a workspace-scoped,
backend-owned headless Chrome streamed into the pane as screencast frames. Frames reach the
pane either as the frames SSE stream or — with the WebSocket prototype, enabled once via
`?browserTransport=ws` (the app rewrites its URL, so the switch persists in localStorage as
`pi-livecraft.browser-transport`; `?browserTransport=sse` switches back) — as binary
messages on one socket that also carries input; the
pane acknowledges each frame once decoded (`image.decode()`, settling either way), renders
blob object URLs (revoking replaced ones), reconnects automatically with backoff, and drops
input produced while disconnected. Opening the
pane starts the browser automatically; there is no iframe mode or manual live toggle.
The current tab uses browser ID `main`; the API already accepts other IDs for later
multi-browser tabs. The pane forwards pointer, wheel, and key input back through the
backend; the address bar drives real CDP navigation; an attach strip shows the copyable
CDP endpoint that agent browser tooling — Chrome DevTools MCP as the canonical example,
via `--browserUrl` — attaches to. Humans and agents watch and drive the same browser.

`BrowserDebugWidget.tsx` adds the right-sidebar **Browser system** panel. It polls
`GET /api/browser/debug` only while mounted and groups every registered browser instance
by canonical workspace path. Each collapsed instance contains its Chrome subprocesses,
session/stream counters, endpoint, and profile path. The widget does not join a
screencast as a viewer.

## Contracts

- Address input is normalized by `normalizeBrowserUrl` (`browser-url.ts`): explicit
  `http(s)://` passes through, scheme-less input gets `http://` on localhost/IP
  hosts and `https://` otherwise, and any other scheme (`javascript:`, `data:`) is
  rejected. `coordinates.ts` maps pane pointer positions into the captured frame
  (pure; both are unit-tested). The toolbar's **Reload page contents** action uses
  CDP `Page.reload`; **Reconnect live browser view** only reconnects the pane's
  screencast stream and does not navigate the controlled page. The pane requires
  a live stream heartbeat before enabling browser controls; a lost or stale stream
  keeps the last frame dimmed, disables page interaction, and leaves only manual
  reconnect enabled.
- `BrowserService` (`server/features/browser/`) groups sessions by canonical workspace
  path and opaque browser ID. Each `BrowserSession` owns one Chrome, its scoped
  `/api/browser/instances/:browserId/*` frame/input/navigation routes, and the emulated
  viewport (`POST .../viewport` →
  `Emulation.setDeviceMetricsOverride` with screencast caps matching the viewport,
  preserving the 1:1 frame-to-viewport coordinate mapping); `src/api.ts` is the
  only frontend boundary. The session lifecycle
  (`off/starting/live/stopped/crashed`) is backend-owned state — the pane only
  renders it.
- The pane's **quality** and **frame rate** dropdowns set the screencast independently
  (JPEG quality 35/60/80/95%, frame rate 2/4/8/12/24 fps; persisted together in
  `pi-livecraft.browser-stream` as `<quality>x<rate>`, default 60% · 12 fps). The backend
  restarts an active screencast with the new settings and derives Chrome acknowledgement
  pacing from the chosen rate; lower values cost less CPU and bandwidth per viewer. After
  a backend restart the stored choice is re-applied once the session is live again.
- The pane's size dropdown (desktop/tablet/mobile presets, persisted in
  `pi-livecraft.browser-viewport`) is the user's choice: it is applied when a
  session becomes live and on explicit selection, but never fights external
  viewport changes while live. The zoom control picks `Auto` (frames scale to the
  pane, with a live percentage readout) or `100%` (natural frame size, scrollable).
- The pane sends pointer moves at most every 32 ms and batches wheel deltas every 50 ms.
  `sendBrowserInput` (`src/api.ts`) then keeps at most one input request in flight per
  browser, so input occupies one connection and reaches Chrome in order; while a request
  is pending, consecutive pointer moves collapse to the latest, and presses, releases,
  wheel, and keys are never merged or reordered. Past 200 queued events it sheds moves
  first and otherwise discards the stale backlog rather than replaying it
  (`test/api-browser-input.test.ts`). This is a stop-gap until the
  [WebSocket transport](/plans/proposals/browser-websocket-transport.md).
- The frames stream holds one of the six HTTP/1.1 connections the browser allows per
  origin across all tabs ([long-lived connections](/docs/DATA-FLOW.md#long-lived-connections)).
  While the document is hidden, the pane closes its event stream and the debug
  widget stops polling; the backend then has no viewers and stops the screencast.
  Returning re-subscribes silently — the last frame stays visible until a fresh
  one replaces it (`use-document-visible.ts`), and the remembered URL is never
  re-applied over pages moved by attached tooling while hidden.
- URL state (`App.tsx`, persisted by workspace path and browser ID) stays in sync
  with the live browser through `url` stream events. While focus is inside the browser
  pane, application-level command shortcuts are disabled so native address-bar editing
  and browser input take precedence.
- The live browser can show sites that reject framing through `X-Frame-Options` or
  `frame-ancestors`; ↗ opens the current URL in a separate window. No search engine;
  IME composition commits through `insertText`.
