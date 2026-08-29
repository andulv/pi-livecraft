# Browser

`BrowserView.tsx` renders the viewer pane's browser tab: an address bar (reload, open-externally) above a sandboxed iframe. It is human-driven only for now; the end goal is agent interaction through browser tools/skills behind the same tab and URL state.

## Contracts

- Address input is normalized by `normalizeBrowserUrl` (`browser-url.ts`): explicit `http(s)://` passes through, scheme-less input gets `http://` on localhost/IP hosts and `https://` otherwise, and any other scheme (`javascript:`, `data:`) is rejected. Covered by `test/browser-url.test.ts`.
- The iframe runs with `sandbox="allow-forms allow-same-origin allow-scripts"` so framed apps (notably local dev servers) keep scripts, forms, and storage. Top-level navigation out of the frame is deliberately not granted.
- Framing limits are inherent: sites sending `X-Frame-Options`/`frame-ancestors` refuse to render; the ↗ link opens the current URL in a real window. No back/forward (blocked cross-origin), no loading detection, no search engine.
- `App.tsx` owns `browserOpen`, `browserUrl` (persisted in `pi-livecraft.browser-url`), and the active pane view (`file path | browser`); the pane hosts the tab next to open file tabs. The URL survives workspace switches; open files do not.
