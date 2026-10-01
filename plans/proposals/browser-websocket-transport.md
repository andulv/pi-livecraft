# Browser viewer over WebSocket

Status: **proposal, third draft**. Owner's design after two review rounds (`browser-websocket-transport-review1.md`, `-review2.md`, `reviewer1-reply1.md`, `reviewer2-reply1.md`); the reviews are input, this document is the spec. Both reviewers consider the design ready for a prototype once implementation and the `ws` dependency are authorized. Remaining questions are in [open questions](#open-questions-for-reviewers-round-2).

## Goal

Move the shared-browser viewer (screencast frames to the tab, input from the tab) off long-lived HTTP/1.1 requests onto one WebSocket per viewer, so the screencast stops competing with snapshots, Git, and `/api/events` for the browser's per-origin connection pool, and frames and input travel over a transport made for continuous two-way traffic. Apply the same pattern to the embedded terminal afterwards.

Non-goals: changing who owns Chrome (`BrowserService`), how agents attach (CDP endpoint), WebRTC or video encoding, HTTP/2, canvas rendering, a multiplexed per-tab socket, moving `/api/events`, or any framework change. Each can be revisited with evidence.

## Why

- Chrome allows **six HTTP/1.1 connections per origin, shared by every tab**. Each tab holds `/api/events`; each visible Browser pane holds a frames SSE stream; an embedded terminal holds another. Three tabs showing the browser exhaust the pool and every other request waits ([long-lived connections](/docs/DATA-FLOW.md#long-lived-connections), [investigation](/plans/investigations/connection-stability.md)). WebSockets use a separate pool (Chromium: 255 per group; Firefox: 200 sessions by default), so a few viewer and terminal sockets are far from any limit.
- **Input costs one HTTP request per event.** `BrowserView.tsx` throttles pointer moves to one per 32 ms (about 31 per second) and batches wheel deltas every 50 ms; a stop-gap in `sendBrowserInput` (`src/api.ts`) keeps one request in flight per browser and merges queued moves, but input still pays a full request per event and holds a pool connection while active.
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

Today `BrowserSession.subscribe()` hands subscribers pre-serialized SSE names and JSON strings. Refactor it to publish typed events (`status`, `url`, and `frame` carrying a shared JPEG `Buffer` decoded once from CDP's base64 before fan-out), and move encoding to each transport adapter. During the transition the SSE adapter keeps today's `wireFor` encoding; the socket adapter never parses JSON strings back into objects. This is the main owning-boundary refactor, more than the upgrade route itself.

Sequences are connection-local, not session-level: **the wire sequence is allocated by the viewer adapter when it sends a frame**, so the same cached image can carry different sequence numbers for different viewers. A session-level capture generation (see below) is a separate concept and never appears on the wire.

### Messages

| Direction | Message | Notes |
|---|---|---|
| server → tab | text `{"type":"status", …BrowserSessionStatus}` | On attach and on every change |
| server → tab | text `{"type":"url","url":…}` | As today |
| server → tab | text `{"type":"heartbeat"}` | Application liveness the tab can observe (protocol pings are invisible to page script) |
| server → tab | binary: 4-byte unsigned sequence number (big-endian) + JPEG bytes | Sequence restarts at 0 per connection; no other header until a field is needed |
| tab → server | text `{"type":"input","event":BrowserInputEvent}` | Envelope keeps `BrowserInputEvent.type` intact; validated by the existing input validation before CDP |
| tab → server | text `{"type":"frameAck","seq":n}` | Restores frame credit for that outstanding frame only |

### Frame flow control

Credit-based from the start, because the browser's WebSocket API has no receive-side backpressure: once a frame is in the tab's message queue, the server cannot retract it, and its buffered amount stays low while the tab falls behind.

- Each viewer starts with **one frame credit**. Sending a frame consumes it; while no credit is available the viewer keeps only the **newest unsent frame**, discarding older ones.
- The tab acknowledges a frame once it is decoded and accepted as the current display frame (below). An acknowledgement that matches the outstanding frame's sequence restores the credit and **immediately flushes the pending frame**, so a static page's last frame arrives even if Chrome produces no more.
- **Only a matching acknowledgement restores credit.** Duplicate, stale, or invalid acknowledgements never add credit.
- **An acknowledgement timeout does not restore credit.** If the outstanding frame is not acknowledged within about 5 s, record the timeout and **close that viewer connection**; no further frames are sent on it. The normal visibility-aware reconnect then establishes a fresh connection with fresh credit. A suspended viewer stays bounded and never blocks healthy viewers. Five seconds is a stall threshold, not a performance target.
- Two credits is a measurement constant only, promoted if delivered FPS pins below Chrome's capture pace while acknowledgement latency varies. One credit keeps the invariant that at most one frame per viewer is undisplayed, and the pending slot is always the newest.
- There is **no buffered-amount guard**: with one credit the outbound queue is at most one frame, so the credit already bounds buffering and the retry-when-drained problem the guard would create cannot arise. (Confirm; see open questions.)
- Chrome capture pacing (`minAckIntervalMs`) stays independent of viewers, so a slow viewer never slows others.
- A **latest-frame cache** in `BrowserSession` (one `Buffer`, no metadata is consumed today) gives a newly attached viewer an immediate first frame; it is sent through normal credit accounting, never bypassing flow control. The cache is cleared when Chrome restarts and when the viewport changes, and is not published after stop or crash. It survives a screencast stop with viewers gone: on re-attach the last frame is still accurate and displays instantly while `startScreencast` warms up.
- **Viewport changes and restarts bump a capture generation.** Viewers discard their unsent pending frame from an old generation, and a late frame from an old generation is not accepted into the cache. An already-sent frame cannot be retracted; its acknowledgement is still accounted, and the renderer simply replaces it with the first frame of the new generation.

### Rendering

Keep `<img>` and keep frames outside React state, as today. For each binary frame: build a JPEG `Blob`, set an object URL on the image with `decoding="async"`, **await `decode()`** — resolving or rejecting — then send `frameAck`, then revoke the replaced URL. A generation check (connection or disposal) before acknowledging ensures a superseded completion never acks on a replacement connection or moves the current frame.

- Acknowledge on settle of `decode()`, not on `load`: `load` fires when data is fetched, not decoded, so a `load` ack can restore credit while the decode backlog the credit exists to expose is still building.
- **Acknowledge on rejection too**, counting it separately: one corrupt JPEG or a `src` replacement mid-decode must not freeze the viewer for the timeout. Rejected frames are never retried.
- Awaiting `decode()` adds no decode work — the JPEG decodes before display regardless — only the acknowledgement round trip, against roughly 8× headroom at Chrome's 12 FPS pacing.
- Handle the first frame that arrives before the image is mounted (today's component already special-cases this). The `load` event is an acceptable fallback path only if it substantially simplifies the renderer; do not implement both.
- Canvas with `createImageBitmap` (in a worker, since main-thread decoding is not guaranteed to leave the main thread) is a profiling-driven option only, and would have to preserve the natural-size coordinate mapping and zoom.

### Input

- Input travels in order on the socket and is dispatched to CDP sequentially per viewer. **Frame acknowledgements are processed independently of the input-dispatch queue**, so slow CDP input cannot block frame credit.
- Keep today's tab-side shaping: pointer moves at most every 32 ms, wheel deltas batched every 50 ms. Additionally merge a pending move with the next move if the socket is still sending; never merge or reorder presses, releases, keys, or text. Batched types are intentional aggregation; **flush any pending move and wheel batch before a button or key transition** so the emitted sequence preserves the original DOM-event order.
- **The server bounds its dispatch work too**: the sequential per-viewer input queue has a limit (start around 256 events); adjacent moves may coalesce, and on overflow the viewer connection is stalled or closed rather than silently dropping key or button transitions. Unsent input is cleared when its connection closes; an already-issued CDP command cannot be recalled.
- No input queue survives a disconnect: input produced while disconnected is dropped, never replayed after reconnecting. While connected, if the tab's outbound buffer grows past a bound, mark the view stalled (non-interactive) instead of silently dropping transitions.

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
- Allowed origins come from configuration: the backend origin in both `127.0.0.1` and `localhost` forms (`PI_LIVECRAFT_BACKEND_PORT`), and the Vite development origin from a `PI_LIVECRAFT_FRONTEND_PORT` (default 5173) shared by `vite.config.ts` and the backend allowlist, with **`strictPort`** so a silently shifted port cannot produce 403s far from the cause. Log the effective allowlist at backend startup and include it in 403 bodies, so misconfiguration is self-diagnosing; two checkouts get distinct ports through the same variables.
- Write the guard once in `server/backend.ts` as a shared helper. **Applying it to the HTTP API is an urgent separate follow-up, not part of this change:** no route checks `Origin`, `Host`, or `Content-Type` today, and `readJsonBody` parses any body, so a cross-site page can send state-changing `text/plain` "simple" requests (no CORS preflight), including terminal input.
- The follow-up's rules: exact allowed `Origin` on state-changing routes for browser requests; `Host` on all API requests; the parsed media type must be `application/json` (parameters such as `charset` allowed) wherever a mutation accepts JSON, and bodyless mutations still need the origin guard; GETs stay Host-checked only; scope includes terminal input (the sharpest edge), resize, browser input/start/stop/navigate/reload, and client-log. A per-launch token is **rejected for now**: a foreign-origin page is blocked before a token would be consulted and cannot read one, and a local process can obtain a token the same way the page can; revisit only if the threat model grows (non-loopback bind, remote access), and then with real authentication.
- One rule for non-browser clients: the documented agent workflow drives the backend with `curl` (`pi-skills/livecraft-browser/SKILL.md`), which sends no `Origin`. Allow a missing `Origin` **only when `Sec-Fetch-Site` is also absent** (a forbidden header page script cannot set): a modern browser always sends one or the other, so "neither present" means a local non-browser client, which is inside the threat model, while cross-site browser requests still carry a mismatching `Origin`.
- Origin is not authentication; for a loopback-only tool this is the proportionate posture.

### Development proxy

Change Vite's `/api` proxy to the object form with `ws: true`, leave `rewriteWsOrigin` disabled so the backend sees the real browser origin, and build the socket URL from the page's own `location` (scheme `ws:`/`wss:`, host) rather than a hard-coded backend address. Because the proxy forwards the original `Host` (no `changeOrigin`), the Host check must accept the development host.

### Diagnostics

- Stability monitor: a `browser-socket` stream kind counted separately from HTTP streams.
- Per window: frames sent, frames replaced (latest-wins), acknowledgement latency, acknowledgement timeouts (connection closures), decode rejections, duplicate or stale acknowledgements, input messages received, input backlog overflows.
- Client reports for socket closes with close code and the tab's connection load, alongside the existing `sse-drop`.

## Rollout

1. **Prototype behind an explicit temporary switch** (preference or query flag), with no automatic fallback to SSE: a fallback would hide failures and bring the pool problem back. Measure (below) with one and three visible viewers, including one deliberately slowed viewer.
2. **Hard gate:** when the success criteria hold, make the socket the only transport in the same change set that deletes the frames SSE route, the input POST route, the input stop-gap, `wireFor`, and their documentation. Do not run both transports beyond the prototype.
3. **Embedded terminal** on the same pattern: output and keystrokes on one socket; a resume offset message replaces `Last-Event-ID` replay; output is ordered and lossless, so it uses acknowledgement-based flow control without dropping.
4. **`/api/events` stays on SSE.** Its native reconnect suits the correctness-critical stream, and with frames and terminal off HTTP it costs one pool connection per tab. Revisit only if the stability monitor shows pool starvation from events alone (six or more tabs).

## Measurements

Input-to-visible-response latency; acknowledgement latency and decode duration; outstanding frames, replacements, and memory per viewer; backend event-loop lag during capture; recovery time after socket loss and backend restart.

## Tests

- Pending frame on a static page is delivered after acknowledgement; first frame on attach comes from the cache and obeys credit accounting, including before the image is mounted.
- Credit accounting: an acknowledgement timeout never increases outstanding frames (the connection closes instead); duplicate, stale, or invalid acknowledgements create no credit.
- Viewport invalidation discards pending old-configuration frames; a late old-generation frame is not cached; an already-sent frame's acknowledgement stays accounted.
- Input ordering survives press → move → release → wheel → key sequences end to end, including flushing batched moves and wheel before button or key transitions; no input replay after reconnect; the server-side input backlog stays bounded when the socket drains quickly.
- Origin and Host guard: allowed, missing, foreign, and rebinding cases.
- Viewer cleanup on close, superseded-socket callbacks ignored, explicit stop not undone.

## Success criteria

- No `browser-frames` HTTP streams and no input POSTs during browser use.
- No HTTP-pool starvation attributable to browser frame or input transport (snapshot or Git work may still stall for other reasons).
- Input ordering preserved under the test sequences above.
- Delivered frame rate and input latency at least as good as today; backend event-loop lag not worse during active capture; a slowed viewer does not reduce others' frame rate.
- Clean recovery after socket loss, hidden tab, backend restart, and laptop sleep, with no manual reload.

## Review log

Round 1 settled: `ws` with `noServer`, no compression, explicit payload limit; Node ≥ 24 correction; binary frames decoded once before fan-out; 4-byte sequence prefix only; `<img>` with object URLs; acknowledgement credit from day one; the `{type:'input', event}` envelope; keeping wheel batching; transport-neutral session events; separate recovery semantics with jitter and no input replay; no automatic SSE fallback with a hard removal gate; per-feature sockets; `/api/events` on SSE; Vite `ws: true` without origin rewriting; the origin guard as a shared helper with the HTTP API as a named follow-up; narrower success criteria.

Round 2 settled: acknowledge on settle of `decode()` (never `load`), including rejections, with a generation check; one credit, two as a measurement constant; the frame cache in `BrowserSession`, never published after stop or crash, consumed through normal credit accounting; pinned Vite port with a shared frontend-port setting and a self-diagnosing allowlist; Origin + Host + JSON Content-Type for the HTTP follow-up, no token.

Corrections the reviews forced in this draft: the v2 acknowledgement timeout restored credit, letting a suspended viewer regain a frame every five seconds — it now closes the connection (reviewer 2); session events carried a sequence number although the wire sequence is per-connection — sequences are now allocated by the viewer adapter at send time (reviewer 2); v2's buffered-amount guard would have needed a retry path to avoid stranding a static page's last frame — dropped, since credit already bounds the outbound queue (my conclusion from both replies); viewport changes must also invalidate viewers' pending frames, not just the cache (reviewer 2); and the server-side input dispatch queue needs its own bound (reviewer 2). The missing-`Origin` allowance for non-browser clients (the documented curl workflow) is my addition after checking `pi-skills/livecraft-browser/SKILL.md`.

## Open questions for reviewers, round 2

1. **Dropping the buffered-amount guard entirely.** With one credit, at most one frame is ever outbound, so I see no case it covers — including the slow-but-acknowledging viewer (bounded by credit) and the dead socket (closed by the acknowledgement timeout). Any residual case before I delete it from the spec?
2. **The missing-`Origin` rule.** Allow absent `Origin` only when `Sec-Fetch-Site` is also absent (non-browser local clients, like the skill's curl workflow). Do you see a hole, given that cross-site browser POSTs always carry `Origin` and `Sec-Fetch-Site` is a forbidden header?
3. **Frontend port plumbing.** One `PI_LIVECRAFT_FRONTEND_PORT` (default 5173) feeding both `vite.config.ts` (with `strictPort`) and the backend allowlist, with development origins always allowed on that port. Acceptable, or should development origins require an explicit opt-in?
