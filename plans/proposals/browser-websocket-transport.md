# Browser viewer over WebSocket

Status: **proposal, second draft**. Owner's current design after two peer reviews (`browser-websocket-transport-review1.md`, `-review2.md`); the reviews are input, this document is the spec. Not yet authorized for implementation; the [open questions](#open-questions-for-reviewers) may still change details.

## Goal

Move the shared-browser viewer (screencast frames to the tab, input from the tab) off long-lived HTTP/1.1 requests onto one WebSocket per viewer, so the screencast stops competing with snapshots, Git, and `/api/events` for the browser's per-origin connection pool, and frames and input travel over a transport made for continuous two-way traffic. Apply the same pattern to the embedded terminal afterwards.

Non-goals: changing who owns Chrome (`BrowserService`), how agents attach (CDP endpoint), WebRTC or video encoding, HTTP/2, canvas rendering, a multiplexed per-tab socket, moving `/api/events`, or any framework change. Each can be revisited with evidence.

## Why

- Chrome allows **six HTTP/1.1 connections per origin, shared by every tab**. Each tab holds `/api/events`; each visible Browser pane holds a frames SSE stream; an embedded terminal holds another. Three tabs showing the browser exhaust the pool and every other request waits ([long-lived connections](/docs/DATA-FLOW.md#long-lived-connections), [investigation](/plans/investigations/connection-stability.md)). WebSockets use a separate pool (Chromium: 255 per group; Firefox: 200 sessions by default), so a few viewer and terminal sockets are far from any limit.
- **Input costs one HTTP request per event.** `BrowserView.tsx` throttles pointer moves to one per 32 ms (about 31 per second) and batches wheel deltas every 50 ms; until 2026-10-01 every such event was an independent, concurrent POST. A stop-gap in `sendBrowserInput` (`src/api.ts`) now keeps one request in flight per browser and merges queued moves, but input still pays a full request per event and holds a pool connection while active.
- **Frames are base64 inside JSON inside SSE.** `wireFor` (`server/features/browser/browser-session.ts`) wraps each CDP JPEG as `{"data":"<base64>"}`; the tab parses it and assigns a `data:` URL. Binary is about 25% smaller than its base64 form and avoids a large string parse per frame.
- **Flow control is server-side only.** Frames are skipped while a viewer's socket has more than 512 KiB queued (`server/backend.ts`). That cannot see a tab whose JavaScript or image decoding falls behind.

The stability monitor is still measuring whether pool exhaustion causes today's dropped connections. The transport problems above hold regardless.

## Alternatives considered

| Option | Decision |
|---|---|
| **WebSocket per viewer** | Chosen. Outside the HTTP pool; two-way and ordered; binary; per-viewer flow control. |
| HTTP/2 | Rejected for now: browsers require TLS for HTTP/2, so localhost would need certificates for backend and Vite proxy. |
| Frames on `/api/events` | Rejected: frames would delay Pi events (head-of-line blocking) and frame dropping would sit inside the correctness-critical stream. |
| One multiplexed socket per tab | Rejected for now: browser frames (discardable), terminal output (ordered, lossless), and Pi events (correctness-critical) need different flow control; a shared ordered socket puts large frames ahead of everything else. Reuse small lifecycle helpers if duplication appears. |
| Streaming `fetch` responses | Rejected: still one HTTP/1.1 connection per stream. |
| WebRTC | Deferred: needs signaling and ICE even on localhost; no evidence yet that JPEG frames are insufficient. |

## Design

### Server library and upgrade boundary

- Use [`ws`](https://github.com/websockets/ws) (needs explicit dependency approval). Node ≥ 24, which this repository requires, ships a WebSocket client but no server; hand-writing framing, masking, fragmentation, and close handling is security-sensitive code a maintained library should own. Pin a patched release.
- Configuration: `noServer: true`, `perMessageDeflate: false` (JPEG is already compressed), `maxPayload` 64 KiB (inbound is only input JSON, including pasted `insertText`).
- `server/backend.ts` stays the single routing and validation boundary: its HTTP `upgrade` handler matches `GET /api/browser/instances/:browserId/socket?workspacePath=…`, validates the workspace and browser ID like other routes, applies the [origin guard](#security), and only then calls `handleUpgrade`. Unknown upgrade paths are refused.
- `server/features/browser/` owns the per-viewer socket session: subscription, flow control, and input dispatch.

### Transport-neutral session events

Today `BrowserSession.subscribe()` hands subscribers pre-serialized SSE names and JSON strings. Refactor it to publish typed events (`status`, `url`, and `frame` carrying a sequence number and a shared JPEG `Buffer` decoded once from CDP's base64 before fan-out), and move encoding to each transport adapter. During the transition the SSE adapter keeps today's `wireFor` encoding; the socket adapter never parses JSON strings back into objects. This is the main owning-boundary refactor, more than the upgrade route itself.

### Messages

| Direction | Message | Notes |
|---|---|---|
| server → tab | text `{"type":"status", …BrowserSessionStatus}` | On attach and on every change |
| server → tab | text `{"type":"url","url":…}` | As today |
| server → tab | text `{"type":"heartbeat"}` | Application liveness the tab can observe (protocol pings are invisible to page script) |
| server → tab | binary: 4-byte unsigned sequence number (big-endian) + JPEG bytes | Sequence restarts at 0 per connection; no other header until a field is needed |
| tab → server | text `{"type":"input","event":BrowserInputEvent}` | Envelope keeps `BrowserInputEvent.type` intact; validated by the existing input validation before CDP |
| tab → server | text `{"type":"frameAck","seq":n}` | Restores frame credit (below) |

### Frame flow control

Credit-based from the start, because the browser's WebSocket API has no receive-side backpressure: once a frame is in the tab's message queue, the server cannot retract it, and its buffered amount stays low while the tab falls behind.

- Each viewer starts with **one frame credit**. Sending a frame consumes it.
- While no credit is available, the viewer keeps only the **newest unsent frame**; older ones are discarded.
- The tab sends `frameAck` once the frame is decoded and accepted for display (`HTMLImageElement.decode()` or `load` on the new image). The acknowledgement restores the credit and **immediately flushes the pending frame**, so a static page's last frame arrives even if Chrome produces no more.
- Secondary guards: skip sending while the socket's buffered amount exceeds about 256 KiB; if no acknowledgement arrives within about 5 s, restore the credit and count the timeout (a lost or very slow tab must not freeze its view forever).
- Two credits is a measurement option if one limits throughput. Chrome capture pacing (`minAckIntervalMs`) stays independent of viewers, so a slow viewer never slows others.
- A **latest-frame cache** in `BrowserSession` gives a newly attached viewer an immediate first frame; it is cleared when Chrome restarts and when the viewport changes.

### Rendering

Keep `<img>` and keep frames outside React state, as today. For each binary frame: build a JPEG `Blob`, set an object URL on the image with `decoding="async"`, revoke the replaced URL once the new one is displayed, and revoke on disposal. Canvas with `createImageBitmap` (in a worker, since main-thread decoding is not guaranteed to leave the main thread) is a profiling-driven option only, and would also have to preserve the natural-size coordinate mapping and zoom.

### Input

- Input travels in order on the socket and is dispatched to CDP sequentially per viewer.
- Keep today's tab-side shaping: pointer moves at most every 32 ms, wheel deltas batched every 50 ms. Additionally merge a pending move with the next move if the socket is still sending; never merge or reorder presses, releases, keys, or text.
- No input queue survives a disconnect: input produced while disconnected is dropped, never replayed after reconnecting. If the socket's outbound buffer grows past a bound while connected, mark the view stalled (non-interactive) instead of silently dropping button or key transitions.

### Lifecycle and recovery

These are distinct and must not be conflated:

| Situation | Behavior |
|---|---|
| Viewer reconnect (socket lost, Chrome alive) | Automatic, with backoff 500 ms doubling to 30 s plus jitter. Re-attaches to the existing Chrome without navigating; status and the cached frame arrive on attach. Callbacks from superseded sockets are ignored. |
| Hidden tab | Close the socket while hidden (rendering and timers are throttled, so an open socket would deliver frames nobody sees); reconnect immediately when visible. The screencast stops when the last viewer leaves, as today. |
| Backend restart | Chrome is gone; the reconnected socket reports a fresh `off` session. The pane then calls the existing idempotent start, as it does today on mount. Whether to restore the remembered URL follows today's pane rules (never over pages moved by attached tooling). |
| Explicit stop | Not undone by automatic recovery: the pane does not call start after a user stop. |
| Chrome crash | Reported through status; recovery is the existing restart behavior, not a socket concern. |

The manual **Reconnect live browser view** action remains.

### Security

- WebSockets are not subject to CORS, so **every upgrade must pass an origin guard**: `Origin` must exactly match an allowed application origin (no substrings or wildcards), a missing `Origin` is rejected, and `Host` must be `127.0.0.1` or `localhost` with an allowed port (DNS-rebinding defense). Reject with 403 before upgrading.
- Allowed origins come from configuration: the backend origin in both `127.0.0.1` and `localhost` forms (`PI_LIVECRAFT_BACKEND_PORT`), and the Vite development origin. Pin the Vite port (`strictPort`, with a `PI_LIVECRAFT_FRONTEND_PORT` defaulting to 5173) so the allowlist cannot silently diverge from the port Vite picks.
- Write the guard once in `server/backend.ts` as a shared helper. **Applying it to the HTTP API is an urgent separate follow-up, not part of this change:** no route checks `Origin`, `Host`, or `Content-Type` today, and `readJsonBody` parses any body, so a cross-site page can send state-changing `text/plain` "simple" requests (no CORS preflight), including terminal input.
- Origin is not authentication. For a loopback-only tool, Origin plus Host plus strict message validation is the proportionate posture here.

### Development proxy

Change Vite's `/api` proxy to the object form with `ws: true`, leave `rewriteWsOrigin` disabled so the backend sees the real browser origin, and build the socket URL from the page's own `location` (scheme `ws:`/`wss:`, host) rather than a hard-coded backend address. Because the proxy forwards the original `Host` (no `changeOrigin`), the Host check must accept the development host.

### Diagnostics

- Stability monitor: a `browser-socket` stream kind counted separately from HTTP streams.
- Per window: frames sent, frames replaced (latest-wins), acknowledgement latency and timeouts, input messages received.
- Client reports for socket closes with close code and the tab's connection load, alongside the existing `sse-drop`.

## Rollout

1. **Prototype behind an explicit temporary switch** (preference or query flag), with no automatic fallback to SSE: a fallback would hide failures and bring the pool problem back. Measure (below) with one and three visible viewers, including one deliberately slowed viewer.
2. **Hard gate:** when the success criteria hold, make the socket the only transport in the same change set that deletes the frames SSE route, the input POST route, the input stop-gap, `wireFor`, and their documentation. Do not run both transports beyond the prototype.
3. **Embedded terminal** on the same pattern: output and keystrokes on one socket; a resume offset message replaces `Last-Event-ID` replay; output is ordered and lossless, so it uses acknowledgement-based flow control without dropping.
4. **`/api/events` stays on SSE.** Its native reconnect suits the correctness-critical stream, and with frames and terminal off HTTP it costs one pool connection per tab. Revisit only if the stability monitor shows pool starvation from events alone (six or more tabs).

## Measurements

Input-to-visible-response latency; acknowledgement latency and decode time; outstanding frames, replacements, and memory per viewer; backend event-loop lag during capture; recovery time after socket loss and backend restart.

## Tests

- Pending frame on a static page is delivered after acknowledgement; first frame on attach comes from the cache; cache cleared on restart and viewport change.
- Credit accounting, acknowledgement timeout, and latest-wins replacement with a fake socket.
- Input ordering survives press → move → release → wheel → key sequences end to end; no input replay after reconnect.
- Origin and Host guard: allowed, missing, foreign, and rebinding cases.
- Viewer cleanup on close, superseded-socket callbacks ignored, explicit stop not undone.

## Success criteria

- No `browser-frames` HTTP streams and no input POSTs during browser use.
- No HTTP-pool starvation attributable to browser frame or input transport (snapshot or Git work may still stall for other reasons).
- Input ordering preserved under the test sequences above.
- Delivered frame rate and input latency at least as good as today; backend event-loop lag not worse during active capture; a slowed viewer does not reduce others' frame rate.
- Clean recovery after socket loss, hidden tab, backend restart, and laptop sleep, with no manual reload.

## Review log

Accepted from the reviews: `ws` with `noServer`, no compression, and an explicit payload limit; Node ≥ 24 correction; binary frames decoded once before fan-out; a 4-byte sequence prefix only; `<img>` with object URLs; acknowledgement credit from day one (review 2 — server-side buffering cannot see a tab's receive queue, which also answers review 1's argument that buffered amount suffices); the `{type:'input', event}` envelope; keeping wheel batching; transport-neutral session events; separate recovery semantics with jitter and no input replay; no automatic SSE fallback with a hard removal gate; per-feature sockets; `/api/events` on SSE; Vite `ws: true` without origin rewriting; the origin guard as a shared helper and the HTTP API as a named follow-up; narrower success criteria and the measurement and test lists.

Corrected in my first draft: pointer moves were already throttled to about 31 per second and wheel batched every 50 ms (the first draft said input was not coalesced); and the input stop-gap's overflow could drop a press or release (fixed: moves are shed first, otherwise the stale backlog is discarded).

## Open questions for reviewers

1. **Acknowledgement point.** Acknowledge after `HTMLImageElement.decode()` resolves on the new image, or on its `load` event? Does awaiting `decode()` per frame add measurable latency at 12 FPS?
2. **One credit or two.** With localhost round trips of a few milliseconds plus decode time, one credit should sustain 12 FPS. Any evidence or experience that two are needed for smooth delivery?
3. **Frame cache location.** I put the latest-frame cache in `BrowserSession` (shared by all viewers and transports). Any reason to keep it per adapter instead?
4. **Pinned Vite port.** `strictPort` makes Vite fail instead of picking another port when 5173 is busy. Acceptable, or is a configured development origin without pinning better?
5. **HTTP API follow-up.** Is Origin plus Host plus requiring `Content-Type: application/json` on state-changing routes enough, or should the follow-up add a per-launch token (for example a header the app injects) given that terminal input is reachable?
