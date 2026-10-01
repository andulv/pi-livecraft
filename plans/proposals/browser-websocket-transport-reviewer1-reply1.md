# Browser viewer over WebSocket — reviewer 1, reply to the second draft

Answers to the five open questions in [the second draft](browser-websocket-transport.md). Draft assessment first, since one answer changes something I argued for in [my review](browser-websocket-transport-review1.md).

## Draft assessment

- Both first-round concerns landed in the right direction: the origin/Host guard is shared infrastructure with the HTTP API named as an urgent follow-up, and the SSE fallback became a hard removal gate.
- **Conceded: acknowledgement credit from day one.** My "latest-wins alone, buffered amount suffices" argument could not see frames already queued inside the tab — review 2's point, and the correct one; a visible-but-janked tab is precisely the case server-side buffering misses. With the ack timeout as the un-freeze valve and the credit tests already in the test list, the complexity is bounded. One deadlock hazard needs an explicit rule; see question 1.
- The transport-neutral session-event refactor is the right owning-boundary move, and the draft is correct that it is the main body of the work — bigger than the upgrade route.

## 1. Acknowledgement point

**Ack after `decode()` resolves, never on `load`** — plus one rule the spec should state explicitly.

- `load` fires when the image data is fetched, not decoded; decoding can still be deferred until first paint (the HTML Standard's own examples warn about a synchronous decode at paint after `load`). An ack on `load` can restore credit while the decode backlog — the thing the credit exists to expose — is still building, reintroducing the blind spot inside the new mechanism.
- `decode()` resolves when the frame is decoded and ready to paint. That is the tab's real "accepted for display" point, and it is the quantity the acknowledgement-latency measurement should time.
- **Required rule: ack also when `decode()` rejects** (corrupt JPEG, or `src` changed while awaiting — both reject with `EncodingError`). Otherwise one corrupt frame freezes the viewer until the 5 s timeout, and a `src` replacement during an in-flight decode (reconnect cache frame, disposal) turns into a spurious freeze. Count rejections separately in diagnostics; never retry the frame.
- Pattern per frame: create the object URL → set `src` → `await decode()` → send `frameAck` → revoke the replaced URL. With one credit there is at most one decode in flight per viewer, so awaiting on the live image is safe; any path that replaces `src` mid-await surfaces through the rejection rule above.
- Latency at 12 FPS: awaiting `decode()` does not add decode cost — the JPEG must decode before display regardless; it only reports completion before the ack. The genuine addition is the ack round trip: localhost RTT of about a millisecond plus decode time, against Chrome's 83 ms pacing interval (`maxFrameRate` 12 / `minAckIntervalMs` 80). No published "typical" decode time is trustworthy (device-, image-, and browser-dependent), which is exactly why the prototype measures it — but the budget has roughly 8× headroom, so decode would have to be pathological before the ack point matters.

## 2. One credit or two

**One. Keep two as the measurement constant only.**

- The one-credit ceiling is 1 / (dispatch + RTT + decode + ack) — tens of FPS even with a pessimistic decode time. The binding constraint is Chrome's own pacing at 12 FPS, so a second credit cannot raise the delivered frame rate at all.
- A second credit changes semantics, not just throughput: one frame can be in flight while another sits undisplayed, so newest-replacement operates one frame later — a marginally staler picture and a second resident JPEG per viewer. The single-credit invariant (at most one undisplayed frame per viewer, and the pending slot is always the newest) is the cleanest expression of latest-wins and the easiest state to test.
- The only thing two credits genuinely buy is absorbing ack-path jitter — the ack handler runs on the main thread, which can jank. That jitter is what the prototype's acknowledgement-latency measurement exists to *observe*, not pre-hide. Promote to two only if the measurements show ack-latency variance pinning delivered FPS below Chrome's pace.

## 3. Frame cache location

**`BrowserSession`, as drafted.** Per-adapter would be worse on every axis that matters here.

- The session already decodes each CDP frame once before fan-out, so the cache is just retaining one `Buffer` — no extra decode, no new ownership. The invalidation events (Chrome restart, viewport change) are already session events; adapters would have to re-subscribe to them and could disagree about the cached frame.
- Per-viewer retention would duplicate the JPEG once per viewer and duplicate the invalidation logic, for no benefit: the cached object is transport-neutral by construction and each adapter encodes from the shared `Buffer`.
- Verified in passing: nothing consumes CDP frame metadata today (no `deviceWidth`/`pageScaleFactor`/`offsetTop` consumers; the view maps coordinates from the rendered image size), so the cache is exactly one `Buffer`. If metadata is ever consumed, cache it beside the `Buffer`, still in the session.
- The sequence number stays per-connection as specced — the cache must not carry one; the adapter stamps its own.
- Keeping the cache across screencast stop (clearing only on restart and viewport change) is correct: on re-attach the last frame is still accurate and displays instantly while `startScreencast` warms up.

## 4. Pinned Vite port

**Pin it (`strictPort` + `PI_LIVECRAFT_FRONTEND_PORT`), as drafted.**

- The unpinned failure mode is the bad one: Vite silently takes 5174, the app loads fine, and every upgrade gets a 403 from the origin guard — the symptom (no frames) lands far from the cause (port drift). A loud startup failure with an env-var escape hatch is strictly better for a local dev tool.
- The alternative — a configured dev origin without pinning — reintroduces the divergence the guard exists to prevent, and the only ways out are range or wildcard allowlisting, which the spec rightly forbids itself.
- Two checkouts at once: the second fails until pointed at its own `PI_LIVECRAFT_FRONTEND_PORT`, which must feed both Vite and the allowlist. That is a coherent workflow; the error message should say exactly that.
- Make misconfiguration self-diagnosing either way: log the effective origin/Host allowlist at backend startup, and include the allowed origins in the 403 body (the guard tests can assert on it).

## 5. HTTP API follow-up

**Origin + Host + `Content-Type: application/json` on state-changing routes is sufficient for the realistic threat (malicious web pages). Skip the per-launch token.**

- The Content-Type requirement is the load-bearing piece: `application/json` makes a cross-site request non-simple, so the browser demands a preflight, which fails before the request reaches the app; form-driven CSRF cannot choose that Content-Type at all. Verified our own client already sends it on every request with a body (`src/api.ts:991`), so the constraint is free — the follow-up only needs `readJsonBody` (or the routes) to *enforce* rather than assume it.
- `Host` remains the DNS-rebinding defense — a rebound page's requests can look same-origin to Origin checks, but cannot forge the `Host`. `Origin` adds defense in depth where the Content-Type bar does not apply.
- The token earns nothing against either attacker class. A foreign-origin page is already blocked before a token would be consulted (and cannot read one). A local process can obtain the token exactly the way the page does — it is served over the same loopback port — so it raises no bar there either. Revisit only if the threat model grows (non-loopback bind, multi-user loopback isolation), and at that point warrant real authentication, not a header.
- If you want a fourth, near-free layer: require `Sec-Fetch-Site: same-origin` or `none` on state-changing routes. It is a forbidden header — page script cannot set it — supported since Chrome 76, Firefox 90, Safari 16.4, all fine for a dev tool. Optional; Content-Type + Origin already cover the browser threat.
- Scope reminder for the follow-up's route inventory: terminal input is the sharpest edge (arbitrary keystrokes into a shell) — include it alongside resize, browser input/start/stop/navigate/reload, and client-log. GETs can stay Host-checked only.

## Bottom line

No blocking concerns. With the ack-on-`decode()`-rejection rule added to the spec (question 1) and the token decided against (question 5), the draft is implementable as written.
