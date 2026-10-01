# Browser viewer over WebSocket

Status: **proposal, first draft for iteration**. These are current suggestions and opinions, not requirements; research items below are expected to change the design before anything is implemented.

## Goal

Move the shared-browser viewer (screencast frames to the tab, input from the tab) off long-lived HTTP/1.1 requests onto one WebSocket per viewer, so the screencast stops competing with snapshots, Git, and `/api/events` for the browser's per-origin connection pool, and so frames and input travel over a transport designed for continuous two-way traffic. Use the same pattern later for the embedded terminal, and decide afterwards whether `/api/events` should follow.

Non-goals: changing who owns Chrome (`BrowserService` in the backend), how agents attach (CDP endpoint), WebRTC or video encoding, HTTP/2, or the manager and its restart semantics.

## Why now

- Chrome allows **six HTTP/1.1 connections per origin, shared by every tab**. Each tab already holds `/api/events`; each visible Browser pane holds a frames SSE stream; an embedded terminal holds another. Three tabs showing the browser exhaust the pool, after which every other request waits indefinitely ([long-lived connections](/docs/DATA-FLOW.md#long-lived-connections), [investigation](/plans/investigations/connection-stability.md)).
- **Input is one POST per event.** `sendBrowserInput` (`src/api.ts`) posts every pointer move, wheel tick, and key to `POST /api/browser/instances/:id/input` without coalescing. Hovering over the pane alone produces dozens of requests per second through the same pool, each with request overhead and no ordering guarantee between them.
- **Frames are base64 in JSON in SSE.** `wireFor` (`server/features/browser/browser-session.ts`) wraps each CDP JPEG (base64 already) as `{"data": "<base64>"}`; the tab `JSON.parse`s it and assigns a `data:` URL. That is about 33% base64 overhead plus a large string parse per frame on both ends.
- The only flow control is server-side: frames are skipped while a viewer's socket has more than 512 KB queued (`server/backend.ts`). The tab cannot signal that it is behind.

Whether exhaustion is what actually causes today's "connection lost" and stuck loading is still being measured by the stability monitor. The transport problems above hold regardless, which is why this proposal does not wait for that result.

## Alternatives considered

| Option | Assessment |
|---|---|
| **WebSocket per viewer** (proposed) | Outside the HTTP connection pool; two-way, so input shares the channel in order; binary messages; per-viewer flow control. Needs a server library or hand-written protocol code, an Origin check, and our own reconnect. |
| HTTP/2 | Multiplexes all streams over one connection, but browsers require TLS for HTTP/2, so localhost would need certificates for the backend and the Vite proxy. High friction for a local tool. |
| Frames on `/api/events` | Removes one connection per tab, but large frames would delay Pi events (head-of-line blocking) and frame-dropping would have to live inside the correctness-critical event stream. |
| Streaming `fetch` responses | Still one HTTP/1.1 connection per stream; same pool problem. |
| WebRTC | Real video encoding and congestion control, but needs signaling and ICE even on localhost. The original [browser bridge](/plans/archive/browser-bridge.md) named it as the escalation after this step; nothing yet suggests we need it. |

## Suggested design

### Endpoint and ownership

- One upgrade route: `GET /api/browser/instances/:browserId/socket?workspacePath=…`. `server/backend.ts` handles the HTTP `upgrade` event and validates path, workspace, and origin exactly like other routes, then hands the socket to the browser feature; it stays the only routing and validation boundary.
- `server/features/browser/` owns the per-viewer socket session: subscribing to `BrowserSession` events, flow control, and input dispatch through the existing validated `cdpInputCommand` path. `BrowserSession.addViewer()` and `releaseViewer()` keep their meaning, so the screencast still starts with the first viewer and stops with the last.
- `src/api.ts` remains the only frontend transport boundary: `subscribeBrowserEvents` keeps its handler shape (`onFrame`, `onUrl`, `onStatus`, `onStreamState`) and gains a `send` path for input, so `BrowserView.tsx` changes little.
- Navigation, reload, viewport, start, and stop stay ordinary POSTs: they are rare, benefit from request/response errors, and do not pressure the pool.

### Messages

Suggested: text messages carry small JSON control messages, and binary messages carry frames.

| Direction | Message | Notes |
|---|---|---|
| server → tab | `{"type":"status", …BrowserSessionStatus}` | On open and on every state change |
| server → tab | `{"type":"url","url":…}` | As today |
| server → tab | `{"type":"heartbeat"}` | Application-level liveness the tab can observe (it cannot see protocol pings) |
| server → tab | binary: small header (frame sequence, optional metadata) + JPEG bytes | Header format is a research item; could be a fixed 8-byte prefix |
| tab → server | `{"type":"input", …BrowserInputEvent}` | Validated with the existing input validation before reaching CDP |
| tab → server | `{"type":"frameAck","seq":n}` | Optional, see flow control |

Opinion: decode CDP's base64 into a `Buffer` once on the server and send binary. On the tab, render from a `Blob` via an object URL (revoking the previous one) or via `createImageBitmap` onto a canvas; which is cheaper is a research item. Sending the base64 as a text message without JSON would be a smaller first step if decoding cost on the server turns out to matter.

### Flow control

- **Latest frame wins, per viewer.** Each viewer has one pending-frame slot. A new frame replaces an unsent one; it is sent only when the socket's buffered amount is below a small threshold (start around 256 KB, then measure). A slow tab therefore sees a lower frame rate instead of growing latency or memory.
- **Optional end-to-end acknowledgement.** The tab sends `frameAck` after decoding a frame, and the server keeps at most one or two unacknowledged frames per viewer. This paces each viewer at its real rendering speed, including a throttled background tab. Worth prototyping, but only if latest-wins alone is not good enough.
- Keep Chrome's screencast acknowledgement pacing (`minAckIntervalMs`) independent of viewers, as today. Coupling Chrome's capture rate to the slowest viewer is possible but not needed now.

### Input

- Send input over the socket in order. Coalesce `mouseMoved` per animation frame on the tab (latest position wins, with the current button state); never coalesce press, release, wheel, or key events, and flush any pending move before them so ordering is preserved.
- The server dispatches input sequentially per viewer, so CDP sees events in the order they were sent. That is an improvement over independent POSTs.

### Liveness and reconnect

- The server sends protocol pings (about every 15 s) to detect dead peers, plus the application heartbeat the tab's watchdog already expects.
- WebSocket has no automatic retry or `Last-Event-ID`. Opinion: reconnect automatically with bounded backoff (500 ms doubling to 30 s), since a browser reconnect is cheap and idempotent (status and the latest frame are resent on open), and keep the manual **Reconnect live browser view** action. While hidden, the tab closes the socket exactly as it closes the SSE stream today, so the screencast still stops when nobody watches.
- Backend restart: the socket closes, Chrome restarts with the backend as today, and the tab reconnects when the backend returns.

### Security

- **Check `Origin` on every upgrade.** WebSockets are not subject to CORS, so any website open in the user's browser could otherwise connect to `ws://127.0.0.1:<port>` and drive the shared Chrome. Accept only the app's own origins: the backend origin in production and the Vite dev origin (both `127.0.0.1` and `localhost` forms), configurable through the existing port environment variables. Reject everything else with 403 before upgrading.
- Also reject `Host` headers other than `127.0.0.1` or `localhost` with the expected port, as protection against DNS rebinding. The same weakness may apply to the existing HTTP API; that is worth a separate look, but out of scope here.
- Validate every inbound message (size limit, JSON shape, input fields) as untrusted, exactly like the current input route.

### Dependency

Node 22 ships a WebSocket client but no server. Opinion: use the [`ws`](https://github.com/websockets/ws) package, the de facto standard server, small and without dependencies of its own, rather than writing the handshake, framing, masking, fragmentation, and close handling ourselves. Adding it needs explicit approval. A hand-written minimal server remains a fallback if a dependency is unwanted.

### Development proxy

Vite's `/api` proxy needs `ws: true` so upgrades reach the backend. Production serves the build from the backend port, so upgrades arrive on the same server without a proxy.

### Diagnostics

- Add a `browser-socket` kind to the stability monitor's stream gauge, counted separately from HTTP streams (it does not consume the HTTP/1.1 pool).
- Count frames sent and dropped (latest-wins replacements) per window, and inbound input messages, so `browser-activity` shows delivery as well as capture.
- Client `sse-drop`-style reports for socket closes, with close code and the tab's connection load.

## Rollout

1. **Prototype behind a switch** (for example a preference or query flag) with the SSE path kept as fallback. Measure frame latency, delivered frame rate, tab CPU, backend event-loop lag, and the stability gauge with one and three tabs.
2. **Make WebSocket the default** once it matches or beats SSE; then remove the frames SSE route, the input POST route, and their client code and documentation.
3. **Embedded terminal** on the same pattern: output to the tab and keystrokes from it on one socket, with a resume offset message replacing `Last-Event-ID` replay.
4. **Decide on `/api/events`** using the stability data: either keep one SSE stream per tab (one pool slot per tab is acceptable), or carry it on a single per-tab socket shared with browser and terminal.

## Research before deciding

- `ws` versus a hand-written server: maintenance, security record, and how cleanly it attaches to the existing `http` server's `upgrade` event.
- Binary frames versus base64 text: server decode cost against tab decode and render cost; `<img>` with object URLs versus `createImageBitmap` and canvas.
- Whether latest-wins alone gives smooth delivery, or acknowledgement pacing is needed; behavior with throttled background tabs.
- Browser WebSocket connection limits per host and profile (believed far above six; confirm for Chrome and Firefox).
- One socket per feature versus one multiplexed socket per tab: simplicity and isolation against the connection count and shared reconnect.
- How Vite's `ws: true` proxy behaves under load and across backend restarts.
- The exact origin allowlist, including how users reach the app (`localhost` versus `127.0.0.1`, custom ports).

## Success criteria

- No `browser-frames` HTTP streams and no input POSTs during browser use.
- No `fetch-stall` or `stream-pressure` entries with three tabs showing the browser while an agent drives it.
- Delivered frame rate and input latency at least as good as today; backend event-loop lag not worse during active capture.
- Clean recovery after backend restart, a hidden tab, and a closed laptop lid, with no manual reload.
