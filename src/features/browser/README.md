# Browser

`BrowserView.tsx` renders the viewer pane's Browser tab in two modes behind one
address bar:

- **Live browser** (default offer): a shared, backend-owned headless Chrome streamed
  into the pane as screencast frames. The pane forwards pointer, wheel, and key
  input back through the backend; the address bar drives real CDP navigation; an
  attach strip shows the CDP endpoint (copyable) that agent browser tooling —
  Chrome DevTools MCP as the canonical example, via `--browserUrl` — attaches to.
  Humans and agents watch and drive the same browser.
- **Iframe fallback** (when no live session runs): the plain sandboxed iframe for
  frameable pages.

## Contracts

- Address input is normalized by `normalizeBrowserUrl` (`browser-url.ts`): explicit
  `http(s)://` passes through, scheme-less input gets `http://` on localhost/IP
  hosts and `https://` otherwise, and any other scheme (`javascript:`, `data:`) is
  rejected. `coordinates.ts` maps pane pointer positions into the captured frame
  (pure; both are unit-tested).
- The backend session (`server/features/browser/`) owns Chrome, the screencast
  stream (`/api/browser/frames` SSE with `frame`/`url`/`status` events), and input
  forwarding; `src/api.ts` is the only frontend boundary. The session lifecycle
  (`off/starting/live/stopped/crashed`) is backend-owned state — the pane only
  renders it.
- URL state (`App.tsx`, persisted in `pi-livecraft.browser-url`) stays in sync with
  the live browser through `url` stream events, so switching between live and
  iframe modes keeps the current page.
- Framing limits apply only to the iframe mode: sites sending
  `X-Frame-Options`/`frame-ancestors` refuse to render there — the live browser
  shows any site, and ↗ opens the current URL in a real window. No search engine;
  IME composition commits through `insertText`.
