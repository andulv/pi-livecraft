# Browser viewer over WebSocket

Status: **fourth draft, prototype implemented** — the socket transport ships behind the
per-view `?browserTransport=ws` flag with the frames SSE route still present (rollout step
1); the HTTP guard prerequisite is implemented. The `ws` dependency was approved. Two review rounds converged (`browser-websocket-transport-review1/2.md`, `reviewer1/2-reply1.md`); this draft then removed everything the converged design did not need — see the [simplification pass](#simplification-pass). Ready to implement pending dependency approval for `ws`.

## Goal

Move the shared-browser viewer (frames to the tab, input from the tab) off long-lived HTTP/1.1 requests onto one WebSocket per viewer, so the screencast stops competing for the browser's six-connection-per-origin pool, and frames and input travel on a transport made for continuous two-way traffic. Apply the same pattern to the embedded terminal afterwards.

Non-goals: changing who owns Chrome, how agents attach, WebRTC, HTTP/2, canvas rendering, a multiplexed per-tab socket, moving `/api/events`, or any framework change.

## Why

- Each tab holds `/api/events`; each visible Browser pane holds a frames SSE stream; a terminal holds another. Three tabs showing the browser exhaust Chrome's **six HTTP/1.1 connections per origin** and every other request waits ([connections](/docs/DATA-FLOW.md#long-lived-connections), [investigation](/plans/investigations/connection-stability.md)). WebSockets use a separate pool (Chromium 255 per group, Firefox 200 by default).
- Input costs one HTTP request per event (moves already throttled to ~31/s, wheel batched at 50 ms), holding a pool connection while active.
- Frames are base64 inside JSON inside SSE — about 25% larger than binary, with a large string parse per frame on the tab.
- Flow control is server-side only (a 512 KiB skip), which cannot see a tab whose decoding falls behind.

## Design

### Transport and boundary

- [`ws`](https://github.com/websockets/ws) with `noServer: true`, `perMessageDeflate: false` (JPEG is already compressed), `maxPayload` 64 KiB. Node ≥ 24 ships no WebSocket server; framing and close handling are security-sensitive code a maintained library should own.
- `server/backend.ts` handles the HTTP `upgrade` for `GET /api/browser/instances/:browserId/socket?workspacePath=…`: validates like any route, applies the origin guard, then `handleUpgrade`. `server/features/browser/` owns the per-viewer socket session.

### Session events

`BrowserSession` emits frames as a decoded JPEG `Buffer` (decoded once, before fan-out — the socket needs bytes). Status and URL keep today's event shape; the SSE adapter keeps `wireFor` encoding until that route is deleted. No further refactor: the socket adapter never re-parses SSE strings, and nothing else changes.

### Messages

| Direction | Message |
|---|---|
| server → tab | text `{"type":"status", …}` / `{"type":"url","url":…}` / `{"type":"heartbeat"}` |
| server → tab | binary: one JPEG per message, no header |
| tab → server | text `{"type":"input","event":BrowserInputEvent}` (envelope keeps the event's own `type`) |
| tab → server | text `{"type":"frameAck"}` |

No sequence numbers: with one credit there is at most one outstanding frame per viewer, so an acknowledgement needs no identity.

### Frame flow control

One credit per viewer; the browser's WebSocket API has no receive-side backpressure, so the tab's own decode pace must close the loop.

- Sending a frame consumes the credit. While it is spent, keep only the **newest unsent frame**; older ones are discarded.
- The tab acknowledges a frame once decoded and accepted as the current display frame: create the object URL, set `src` with `decoding="async"`, await `decode()` — **resolving or rejecting** — then ack, then revoke the replaced URL. A generation check (connection/disposal) before acknowledging keeps superseded completions silent. Ack on settle of `decode()`, not `load`: `load` fires before decoding. Rejections are counted and never retried.
- An ack restores the credit and immediately sends the pending frame, so a static page's last frame still arrives. An ack with nothing outstanding is ignored — with one credit that rule alone makes duplicates and stale acks harmless.
- **An acknowledgement timeout (about 5 s) closes the viewer connection.** It never restores credit: a suspended viewer must not regain a frame per timeout forever. The visibility-aware reconnect re-establishes fresh state.
- Two credits exist only as a measurement constant if delivered FPS pins below Chrome's 12 FPS pace while ack latency varies.
- Chrome capture pacing (`minAckIntervalMs`) stays independent of viewers.
- The **latest frame is cached in `BrowserSession`** (one `Buffer`) so a new viewer gets an immediate first frame through normal credit accounting. Cleared on Chrome restart, viewport change, and stop/crash; survives a viewer-less screencast stop. Viewport change also drops the pending unsent frame; any already-in-flight old-configuration frame is replaced by the next frame (accepted race, bounded by one frame interval).

### Rendering

Keep `<img>`, frames outside React state, natural-size coordinate mapping, and zoom. Blob object URLs, revoked on replacement and disposal. Handle the first frame before the image mounts (today's component already special-cases this). Canvas/`createImageBitmap` only if profiling shows decode jank.

### Input

- Input travels in order on the socket; CDP dispatch is sequential per viewer; frame acks are processed independently of that queue.
- Keep today's tab-side shaping (moves ≤ 1/32 ms, wheel batched at 50 ms) and merge a pending move with the next move while sending. Flush pending move/wheel batches before button or key transitions so the emitted order matches the DOM order. Never merge or reorder presses, releases, keys, text.
- The server's dispatch queue has a bound (about 256): on overflow, close the connection. Input produced while disconnected is dropped, never replayed.

### Lifecycle

| Situation | Behavior |
|---|---|
| Socket lost, Chrome alive | Automatic reconnect, backoff 500 ms doubling to 30 s with jitter; re-attach without navigating; status and cached frame arrive on attach; superseded sockets' callbacks ignored. |
| Hidden tab | Socket closed while hidden, reconnected on visibility; screencast stops when the last viewer leaves. |
| Backend restart | Reconnected socket reports a fresh `off` session; the pane calls the existing idempotent start, as on mount. URL restoration follows today's pane rules. |
| Explicit stop | Never undone by automatic recovery. |

The manual reconnect action remains. Server sends protocol pings (about 15 s) plus the heartbeat the tab's watchdog uses.

### Security

- Every upgrade passes the origin guard: `Origin` exactly matches an allowed origin (no wildcards), missing `Origin` rejected, `Host` is `127.0.0.1`/`localhost` with an allowed port. 403 before upgrading.
- Allowed origins from configuration: the backend origin (`PI_LIVECRAFT_BACKEND_PORT`, both host forms) and the Vite origin from `PI_LIVECRAFT_FRONTEND_PORT` (default 5173) shared with `vite.config.ts`, which pins it with `strictPort`. Log the effective allowlist at startup and in 403 bodies.
- **The HTTP API fix is a separate, urgent prerequisite, not part of this change:** no route checks Origin, Host, or Content-Type today, and `readJsonBody` parses any body, so any website can send state-changing "simple" `text/plain` requests — terminal input included. Rules: exact Origin on mutations for browser requests (absent Origin allowed only when `Sec-Fetch-Site` is also absent, which admits the documented curl workflow while no page can strip `Sec-Fetch-Site`); Host on all API requests; parsed media type `application/json` on JSON mutations; GETs Host-checked only. No per-launch token: it stops neither a foreign page (blocked earlier, cannot read one) nor a local process (can fetch it like the page does).
- Origin is not authentication; for a loopback-only tool this is the proportionate posture.

### Development proxy

Vite `/api` proxy gains `ws: true`; the socket URL is built from the page's own `location`. The proxy forwards the original `Host`, which the Host check accepts.

### Diagnostics

Stability monitor gains a `browser-socket` stream kind (separate from HTTP streams). Per window: frames sent, frames replaced, ack latency, ack timeouts, input messages. Client reports for socket closes with close code and connection load.

## Rollout

1. Prototype behind an explicit temporary switch, **no SSE fallback** (a fallback would hide failures and restore the pool problem). Measure with one and three visible viewers, one deliberately slowed.
2. **Hard gate:** when the success criteria hold, the same change set deletes the frames SSE route, the input POST route, the input stop-gap, and their documentation.
3. Embedded terminal on the same pattern; a resume offset replaces `Last-Event-ID` replay.
4. `/api/events` stays on SSE — its native reconnect suits the correctness-critical stream, and with frames and terminal off HTTP it costs one connection per tab.

## Measurements

Input-to-visible latency; ack latency and decode duration; frames sent/replaced; backend event-loop lag during capture; recovery time after socket loss and backend restart.

## Tests

- Static page's pending frame delivered after an ack; cached first frame obeys credit, before image mount.
- Ack timeout closes the connection; an ack with nothing outstanding is ignored; duplicate acks create no credit.
- Input ordering across press → move → release → wheel → key, including batch flushing; no replay after reconnect; server input backlog bounded.
- Origin/Host guard: allowed, missing, foreign, rebinding.
- Viewer cleanup, superseded sockets, explicit stop not undone.

## Success criteria

- No `browser-frames` HTTP streams and no input POSTs during browser use; no HTTP-pool starvation attributable to browser transport.
- Input ordering preserved; delivered frame rate and latency at least as good as today; event-loop lag not worse; a slowed viewer does not slow others.
- Clean recovery after socket loss, hidden tab, backend restart, sleep — no manual reload.

## Review log

Round 1 settled the library (`ws`, `noServer`, no compression, payload limit), binary frames decoded once before fan-out, `<img>` with object URLs, credit-based pacing from day one, the `{type:'input', event}` envelope, keeping wheel batching, per-feature sockets, `/api/events` on SSE, no SSE fallback with a hard removal gate, the shared origin guard with the HTTP API as a follow-up, and Node ≥ 24.

Round 2 settled ack on settle of `decode()` including rejections with a generation check, one credit, the session-owned frame cache, the pinned Vite port, timeout-closes-connection, and Origin + Host + JSON Content-Type (no token) for the HTTP fix.

## Simplification pass

Convergence had accreted mechanisms that were each defensible in isolation. This draft removed them; one decision — **exactly one frame credit** — makes most of them provably unnecessary:

- **Sequence numbers** (wire prefix, byte order, per-connection resets): with one outstanding frame, an ack needs no identity; "ack with nothing outstanding is ignored" makes duplicates and stale acks harmless by construction.
- **Capture-generation counter**: latest-wins replaces stale pending frames naturally; clearing the cache on restart/viewport/stop is one line. The one-frame race on viewport change is accepted and bounded.
- **Client-side stall state**: closing the connection is already the bound everywhere; a separate non-interactive mode duplicated it.
- **Full transport-neutral refactor**: reduced to the one typed event the socket actually needs (frames as `Buffer`); status and URL keep today's shape until the SSE route dies.
- **Buffered-amount guard**: dropped — one credit bounds the outbound queue to a single frame.
- Diagnostics for cases that cannot occur (duplicate-ack accounting), and speculative constants kept as prose rather than state.

Deliberately kept, each with a reason: the ack (the only signal of the tab's real pace, ~30 lines, first thing to delete if it misbehaves), timeout-closes (one rule, total bound), the origin/Host guard and HTTP fix (a hole, not complexity), `strictPort` (prevents a failure whose symptom lands far from its cause), and close-when-hidden.
