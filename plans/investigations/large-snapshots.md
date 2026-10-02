# Large session snapshots and event-loop lag

Status: open investigation, opened 2026-10-02. Point-in-time measurements; live numbers are in the [stability monitor](/server/features/diagnostics/README.md#stability-monitor) and the app log (`slow-snapshot`, `event-loop-lag`).

## Finding

While an agent works in a long-running session, opening (or reloading into) that session costs noticeably, and the backend's event loop stalls:

- Full snapshots of the largest session measured **5,225,308 bytes** (5.2 MB), taking **1.2–2.8 s** total. The time is dominated by `rpcMs` — waiting for Pi's `get_entries` (1.1–1.8 s) — with build and template reads in single-digit milliseconds.
- `event-loop-lag` entries (worst 218–668 ms per 10 s window) **correlated with those snapshot completions** while `browserFrames` was 0 — the screencast was not involved. Serializing a 5 MB JSON response and writing it to the socket happens synchronously on the main loop.
- The cost repeats: every frontend reload, session selection, and reconnect of that session produces another full snapshot (delta mode only helps subsequent refreshes).

Root causes, ranked by measured share:

1. **Pi RPC wait** (`get_entries`): Pi serializes the whole session history per request. Not fixable in Livecraft except by caching — and entries change on every message, so caching buys little.
2. **Backend serialization and write**: one `JSON.stringify` of ~5 MB plus a chunked socket write, on the main loop.
3. **Client parse and render** of the same 5 MB (outside these measurements).

## Suggestions, in order of cost

1. **Compress snapshot responses** (`GET /api/sessions/:id/snapshot` is a regular request/response, not SSE): when the client sends `Accept-Encoding: gzip` and the payload is large, stream it through `zlib.createGzip()`. Session history is highly repetitive JSON — expect roughly 10× smaller transfers, cheaper socket writes, faster loads. Small, safe, no contract change (standard HTTP content negotiation).
2. **Serialize off the event loop** if lag entries persist after (1): `JSON.stringify` in a `worker_threads` worker for payloads above a threshold, streaming the result back. Moderate complexity; measure first.
3. **Cap the initial full snapshot** (product decision): deliver the newest N messages and load older history on demand. Removes the 5 MB payload entirely but changes conversation behavior (scroll-back loading), so it needs design before implementation.

## How to verify

Reproduce with the large session selected, then apply one change at a time and compare: `slow-snapshot` total and byte entries, `event-loop-lag` frequency and worst delay during `snapshot:selection` triggers, and time-to-first-paint of the conversation in the pane. The gzip change should show in bytes immediately; lag entries should drop only if serialization/write was the dominant share — otherwise the remaining spike is the `get_entries` wait, which only suggestion 3 removes.
