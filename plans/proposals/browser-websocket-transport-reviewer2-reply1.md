# Browser WebSocket transport — reviewer2 reply 1

Review target: the second draft of `browser-websocket-transport.md`.

## Verdict

The revised direction is sound. I support implementing it with `ws`, binary JPEGs, one socket per viewer, and acknowledgement-based pacing. No framework change is needed.

One remaining change is important before implementation: **an acknowledgement timeout must not restore credit on the same connection**. That defeats the bounded-delivery guarantee. Details and suggested wording follow the answers.

## Answers to the open questions

### 1. Acknowledgement point: `decode()` or `load`?

**Prefer `HTMLImageElement.decode()`**, then acknowledge once the decoded frame has been accepted as the current display frame. This expresses the intended contract more precisely than `load`: the ACK represents completed decoding, not merely receipt of the WebSocket message. It does not prove that pixels have been physically presented.

A minimal implementation can set the object URL on the existing image and await its `decode()` promise. Keep the image mounted, or explicitly handle the initial frame that arrives before React mounts it; today's component already needs special handling for this case. One outstanding frame avoids overlapping frame replacements in normal operation.

Use a connection/disposal generation check after the asynchronous operation. If the component unmounts, the connection changes, or the source is superseded, its completion must not ACK on the replacement connection or update the current frame. Handle decode rejection explicitly rather than leaving credit stuck until a generic timer expires. Revoke object URLs on replacement and disposal, including failed/discarded frames.

`load` is an acceptable alternative if it substantially simplifies the renderer; install the handler before assigning `src` and keep the same stale-completion/error rules. I would not implement both paths speculatively.

**I have no measured evidence that awaiting `decode()` materially hurts this viewer at 12 FPS.** The decoding work must happen either way; the deliberate difference is that the server now waits for its completion before sending another frame. Measure decode duration and ACK latency rather than assuming either API is faster.

Sources: [MDN: image decode](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode), [MDN: Blob URL lifecycle](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob).

### 2. One credit or two?

**Start with one. I have no workload-specific evidence justifying two now.**

At 12 FPS the nominal frame interval is about 83 ms. One credit should sustain that rate when the full send → delivery → decode → ACK cycle normally fits inside that interval. Localhost network latency alone is not the deciding metric: decoding, main-thread scheduling, and CPU contention also contribute.

Compare one and two credits only if measurements show capture near its intended rate but materially lower delivery caused by waiting for ACKs. Use delivered FPS, ACK-latency percentiles, and input-to-visible-response latency together. Two credits can hide occasional delays, but can also put another stale frame ahead of the newest one.

Keep one as a fixed initial implementation choice, not a user preference. Retain a testable window-size parameter only if needed for the experiment.

### 3. Frame cache location?

**`BrowserSession` is the right owner.** The latest captured image belongs to the shared browser, not to one transport. It also avoids retaining independently encoded copies for every viewer.

Keep these two concepts separate:

- Session cache: the latest valid shared JPEG buffer for the current capture configuration.
- Viewer state: its pending frame, outstanding ACK, and connection-local wire sequence.

There is a small contradiction in the draft: session events carry a sequence number, but the binary sequence restarts per connection. Allocate the **wire sequence in the viewer adapter when sending**. A session-level capture identifier is optional and should not be confused with that wire sequence. The same cached image can have different wire sequence numbers for different viewers.

Clearing the session cache on viewport change is necessary but insufficient if viewers still hold pending old-size frames. Invalidate their unsent pending frames too, and do not accept a late frame from the previous capture configuration back into the cache. An already-sent frame cannot be retracted; its ACK still needs correct accounting, and the renderer must not mistake it for a fresh frame from the new configuration.

The cached frame on attach must consume the normal frame credit, not bypass flow control. Do not publish cached images as current after stop/crash; clear or withhold them consistently with lifecycle state.

### 4. Pinned Vite port?

**Yes: configurable port plus `strictPort` is acceptable and preferable here.**

Silent port selection adds avoidable disagreement between the actual development origin and the backend allowlist. A clear startup error with instructions to set `PI_LIVECRAFT_FRONTEND_PORT` is reasonable for this local development tool. It also supports running multiple checkouts with intentionally different ports.

Configure Vite and the backend from the same port setting, allow the documented `localhost`/`127.0.0.1` variants, and only enable development origins when development access is intended. Do not add dynamic origin discovery merely to preserve Vite's fallback behavior.

Source: [Vite server options](https://vite.dev/config/server-options#server-strictport).

### 5. HTTP follow-up: origin/host/JSON, or a token?

**For the stated prototype threat model, exact Origin + Host checks and JSON-only mutation bodies are a proportionate first follow-up. A per-launch token is not required before the transport work.**

The follow-up should define these rules explicitly:

- Apply guards to every state-changing API route, including terminal input. No mutations through GET.
- Require an exact allowed Origin on browser mutation requests; reject missing and `null` origins unless a separately defined authenticated non-browser path needs them. Do not silently exempt requests without Origin.
- Validate Host on API requests. Keep binding to loopback.
- Require the parsed media type `application/json` wherever a mutation accepts JSON; allow normal parameters such as `charset=utf-8`. Reject `text/plain` and form bodies. Bodyless mutations still need the origin guard.
- Do not introduce permissive cross-origin response headers that undermine the intended boundary.

Content-Type is a useful browser-request constraint, **not authentication**. Origin/Host enforcement addresses unwanted websites driving the localhost app, not an untrusted local process that can construct arbitrary headers.

Add a per-launch token if the intended threat model expands to unauthenticated non-browser clients or remote/proxied access. It would need a defined bootstrap/distribution mechanism and coverage across HTTP and WebSocket entry points. A custom header on HTTP alone does not cover browser WebSocket handshakes, which cannot set arbitrary headers. Also, a token is not isolation from another local process that can read the app's token or environment.

Terminal control raises the consequence of a mistake, so the shared HTTP guard deserves focused tests and a prompt follow-up. It does not require an authentication subsystem to be bundled into this prototype.

## Remaining design corrections

### A. Do not grant new credit on an ACK timeout

The current wording says to restore credit after about five seconds. A suspended receiver could therefore accumulate one additional frame every five seconds indefinitely. Late ACKs also risk double-granting credit. This reintroduces the receive-queue problem that ACKs were chosen to solve.

Suggested replacement:

> If an outstanding frame is not acknowledged within the timeout, record the timeout and close that viewer connection. Do not restore credit or send further frames on it. Normal visibility-aware reconnect establishes a fresh connection and fresh credit state. Only an ACK matching an outstanding frame restores credit; duplicate, stale, or invalid ACKs never add credit.

Five seconds is a reasonable initial stall threshold, not a performance target. Discard old-connection decode callbacks during recovery. A slow or suspended viewer must remain bounded and must not block healthy viewers.

If the buffered-amount guard defers a send, also specify how the pending frame is retried. It must not require another capture event, or a static page can again leave its last frame pending forever.

### B. Bound server-side input work too

The client outbound-buffer check is not sufficient: the server may read WebSocket messages quickly while its sequential CDP dispatch queue grows. Give that queue a bound, coalesce only eligible adjacent moves, and close/stall the viewer on overflow rather than dropping arbitrary key/button transitions. Clear unsent input when its connection closes; an already-issued CDP command cannot be recalled.

Process frame ACKs independently of the awaited input-dispatch queue so slow CDP input cannot unnecessarily block frame credit.

Finally, clarify that the existing 50 ms wheel batch is intentional aggregation, and that ordering guarantees apply to the resulting emitted events unless all deferred input types are flushed before later transitions. Keeping separate move/wheel timers does not by itself preserve the original DOM-event order.

### C. Add focused regression cases

Alongside the draft's tests, include:

- ACK timeout never increases the number of outstanding frames on a connection.
- Duplicate/stale ACKs do not create credit.
- Cached first-frame delivery obeys credit accounting and works before image mount.
- Viewport invalidation discards pending old-configuration frames.
- Server-side input backlog stays bounded even when the socket itself drains quickly.

These are protocol correctness tests, not additional hardening work. With those clarifications, I consider the design ready for a prototype once implementation and dependency installation are authorized.
