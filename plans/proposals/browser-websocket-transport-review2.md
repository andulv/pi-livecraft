Overall opinion

I support the WebSocket direction. It fits this workload better than SSE plus input POSTs, and it can be implemented without changing Chrome ownership, agent attachment, or the manager.

I would change three things before implementation:

    Make frame acknowledgements part of the initial design, not an optional optimization.
    Specify reconnection separately from Chrome recovery. The proposal currently conflates them.
    Use ws outright; remove the hand-written server fallback.

Your willingness to change frameworks is useful, but I found no reason to do so here. This is a transport and lifecycle problem, not a React, Vite, or Node limitation.
What the code actually does today

The proposal is mostly accurate, with some important qualifications:
Area	Current implementation
Capture	browser-session.ts receives CDP base64 JPEGs, paces CDP acknowledgements, serializes each event once, and shares it among subscribers.
Frame delivery	backend.ts:943 drops frames when the response buffer exceeds 512 KiB. There is no pending latest-frame slot or cached-frame replay.
Rendering	BrowserView.tsx:197 writes data URLs directly to an <img>, avoiding React renders at frame rate. Preserve that useful separation.
Input	api.ts:634 already serializes POSTs per target and merges consecutive queued moves. The component also throttles moves to roughly 31 Hz and batches wheel deltas every 50 ms.
Input overflow	The queue drops its oldest event after 200 entries—including potentially a press or release. The claimed preservation of important events does not hold under overflow.
Stream recovery	api.ts:749 explicitly closes a failed/stale EventSource. It does not automatically retry browser streams. Visibility changes or manual reconnect recreate the subscription.
Browser recovery	BrowserView.tsx:185 calls the idempotent start endpoint when its subscription effect runs. The backend itself does not automatically recreate Chrome after restarting.

Consequently, WebSocket gives you cheaper input transport, but ordinary input ordering is already substantially improved by the current queue.

Also, the project already targets Node ≥24 and Vite 8; the proposal’s Node 22 discussion should be updated, although its client-versus-server distinction remains correct.
Recommendations for the open questions
1. ws versus a hand-written server

Choose ws. This question is settled enough to implement.

Its documented noServer / handleUpgrade() pattern fits the existing Node HTTP server and preserves backend.ts as the routing boundary. No framework migration is needed.

Suggested configuration:

    noServer: true
    perMessageDeflate: false
    A small, explicit inbound message limit appropriate for input and paste
    Upgrade validation in backend.ts
    Per-viewer behavior in server/features/browser/

JPEG is already compressed; another compression layer is unnecessary overhead here.

ws has published security advisories, so choose a maintained, patched release—not because hardening should dominate the prototype, but because maintaining your own framing, fragmentation, close handling, and parser would be wasted work.

Sources: ws usage and upgrade examples, security advisories.
2. Binary versus base64; <img> versus canvas

Start with binary JPEG and keep <img>.

Decode CDP’s base64 once per captured frame, before viewer fan-out. Share the resulting buffer across viewers.

This removes the base64 expansion from the backend-to-viewer leg: binary is approximately 25% smaller than equivalent base64, excluding envelopes. It does not eliminate CDP’s existing base64 encoding.

On the client:

    Receive a binary frame.
    Construct a JPEG Blob and object URL.
    Decode/display it.
    Revoke replaced URLs and clean up on disposal.

Keep frames outside React state.

I found no credible universal evidence that createImageBitmap plus canvas is faster for this workload. It introduces drawing and bitmap-lifecycle work, and changing the image element also affects your existing natural-size coordinate mapping and zoom behavior.

Canvas should be a profiling-driven next step, not a prerequisite.

Sources: Blob URL lifecycle, HTMLImageElement.decode(), Chrome’s createImageBitmap discussion.
3. Latest-wins versus acknowledgements

Use both from the start. This is my strongest architectural recommendation.

Checking server-side bufferedAmount only tells you about outbound buffering. A browser can keep accepting network data while its JavaScript or image decoder falls behind.

The standard browser WebSocket API has no receive-side backpressure. Once a frame has entered WebSocket/TCP/browser buffers, your latest-wins slot cannot retract it.

A small initial protocol is sufficient:

    Each viewer gets one frame credit.
    Sending a frame consumes the credit.
    While waiting, retain only the newest unsent frame.
    The client acknowledges after decoding and accepting the frame for display.
    The ACK restores credit and immediately flushes the pending frame—even if Chrome produces no further frames.

Start with one outstanding frame; test two if throughput suffers. Keep a byte-buffer guard and an ACK timeout as secondary protections.

Do not call the ACK “painted” unless you actually measure presentation; image decode completion does not prove physical display.

Keep CDP capture pacing independent, as proposed. One slow viewer should not slow everyone else.

This follows established patterns:

    Chrome DevTools acknowledges CDP frames on receipt before handing them to the view; its ACK is not a rendering acknowledgement.
    Apache Guacamole uses synchronization acknowledgements tied to completed drawing work.
    xterm.js recommends application-level ACKs after output processing because WebSocket buffering alone cannot provide end-to-end flow control.

Sources: WebSocket backpressure limitation, DevTools capture model, Guacamole protocol, xterm.js flow control.
4. WebSocket connection limits

Relevant to confirm, but not a design blocker.

Browsers manage WebSockets separately from the six ordinary HTTP/1.1 connections. Chromium source documents a 255-per-group WebSocket setting, and Firefox has a default 200 concurrent-session preference.

These are implementation settings with different scopes—not a portable “sockets per profile” guarantee. The important conclusion is that a handful of viewer and terminal sockets is nowhere near the relevant limits.

Sources: Chromium socket-pool settings, Firefox WebSocket implementation.
5. Per-feature sockets versus one multiplexed socket

Use one socket per viewer attachment, and later one per terminal attachment. Keep /api/events separate initially.

These streams have different correctness requirements:

    Browser frames: old data can be discarded.
    Terminal output: ordered data must not silently disappear.
    Pi events: reconciliation and correctness matter more than visual freshness.

A shared socket introduces scheduling, channel lifecycle, and backpressure coordination. It also puts large frames ahead of unrelated server-to-client messages on the same ordered connection.

Reuse small lifecycle helpers if duplication actually appears. Do not build a generic multiplexer now.

One caution: leaving /api/events on SSE means the six-connection problem is reduced, not universally eliminated. Enough open tabs can still exhaust the ordinary HTTP pool.
6. Vite proxy behavior

Use the documented proxy mechanism; verify restart behavior locally.

Change the /api proxy to an object with ws: true. Construct the client URL from the current page’s host and scheme rather than hard-coding the backend address.

Leave rewriteWsOrigin disabled so the backend can see the real browser origin.

Vite’s documentation establishes support for forwarding upgrades, but it does not prove your application’s recovery behavior under load or backend restart. Those are integration tests, not further architecture research.

Source: Vite server proxy documentation.
7. Origin allowlist

Keep it simple and explicit; don’t let it delay the concept.

Validate the actual application origin during upgrade, with production and development origins configured separately.

One correction: the current configuration has a backend-port environment variable, but no equivalent explicit frontend-port configuration. Vite may also select another port if its preferred one is occupied.

Choose either:

    A pinned development port with strictPort, or
    An explicit configured development origin.

A narrow upgrade path, origin check, payload limit, and existing input validation are enough initial boundaries. Broader HTTP hardening can remain separate.
Additional proposal changes I recommend
Fix the input message envelope

This proposed shape is ambiguous:

{ type: 'input', ...BrowserInputEvent }

BrowserInputEvent already contains type.

Use:

{ type: 'input', event: BrowserInputEvent }

For frames, a small fixed sequence-number prefix plus JPEG is sufficient. Document byte order and reset sequences per connection; an elaborate binary protocol is unnecessary.
Make the session event API transport-neutral

Currently, BrowserSession.subscribe() exposes already-serialized SSE event names and JSON strings.

Do not make the WebSocket adapter parse those strings back into objects. Have the session publish typed events/shared frame buffers, with transport encoding at the adapter boundary.

This is the main owning-boundary refactor—not merely adding an upgrade route.
Specify recovery explicitly

A socket reconnect does not recreate a lost Chrome process.

Define these separately:

    Viewer reconnect: attach to existing Chrome without navigating it.
    Backend restart: detect a fresh/off session, invoke the existing start behavior, and decide whether restoring the remembered URL is desired.
    Explicit stop: do not silently undo it through automatic recovery.
    Hidden tab: close the attachment and reconnect immediately on visibility return.

Add jitter to backoff and ignore callbacks from superseded connections. Never replay queued user input after reconnection.

Also, “resend the latest frame on open” requires a new cache. Invalidate it across browser restarts and viewport changes.
Bound input without silently losing releases

Preserve ordered input, but do not inherit the current “drop oldest event” overflow behavior.

Coalesce moves; bound the remaining queue; on overflow, surface a stalled connection rather than silently dropping key/button transitions. Cancel stale input on disconnect.

The existing wheel batching should be reviewed explicitly—the proposal’s “never coalesce wheel” would change current behavior.
Suggested prototype and acceptance criteria

I would build a small end-to-end prototype with binary frames, one-frame ACK pacing, and input on the same socket. An explicit temporary switch is useful for comparison; automatic SSE fallback would mask failures and reintroduce the connection problem.

Measure:

    Input-to-visible-response latency
    Frame ACK latency and decode time
    Outstanding frames, pending replacements, and memory
    Backend event-loop lag
    Recovery after connection loss and backend restart
    Three simultaneous visible viewers, including one deliberately slowed viewer

Add tests for a static page’s pending frame being delivered after ACK, first-frame rendering, viewer cleanup, and stale reconnect callbacks.

Replace “no fetch stalls” with a narrower criterion: no HTTP-pool starvation attributable to browser frame/input transport. Git work or snapshot processing can still cause stalls independently.

Bottom line: proceed with WebSocket and ws; keep the current renderer initially; include end-to-end frame pacing immediately; and tighten lifecycle semantics before coding. HTTP/2, WebRTC, canvas, framework replacement, and shared-socket multiplexing can all wait for evidence.

Read-only review; no files changed or tests run.