# Browser

`BrowserView.tsx` renders the viewer pane's Browser tab as a workspace-scoped,
backend-owned headless Chrome streamed into the pane as screencast frames. Opening the
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
  (pure; both are unit-tested).
- `BrowserService` (`server/features/browser/`) groups sessions by canonical workspace
  path and opaque browser ID. Each `BrowserSession` owns one Chrome, its scoped
  `/api/browser/instances/:browserId/*` frame/input/navigation routes, and the emulated
  viewport (`POST .../viewport` →
  `Emulation.setDeviceMetricsOverride` with screencast caps matching the viewport,
  preserving the 1:1 frame-to-viewport coordinate mapping); `src/api.ts` is the
  only frontend boundary. The session lifecycle
  (`off/starting/live/stopped/crashed`) is backend-owned state — the pane only
  renders it.
- The pane's size dropdown (desktop/tablet/mobile presets, persisted in
  `pi-livecraft.browser-viewport`) is the user's choice: it is applied when a
  session becomes live and on explicit selection, but never fights external
  viewport changes while live. The zoom control picks `Auto` (frames scale to the
  pane, with a live percentage readout) or `100%` (natural frame size, scrollable).
- URL state (`App.tsx`, persisted by workspace path and browser ID) stays in sync
  with the live browser through `url` stream events. While focus is inside the browser
  pane, application-level command shortcuts are disabled so native address-bar editing
  and browser input take precedence.
- The live browser can show sites that reject framing through `X-Frame-Options` or
  `frame-ancestors`; ↗ opens the current URL in a separate window. No search engine;
  IME composition commits through `insertText`.
