# Connection stability and the shared browser

Status: open investigation, started 2026-10-01. Point-in-time analysis; current contracts live in [data flow](/docs/DATA-FLOW.md#long-lived-connections), [diagnostics](/server/features/diagnostics/README.md#stability-monitor), and the [app log](/server/features/app-log/README.md).

## Question

"Connection to backend lost" and a view stuck on "Pi is getting things ready…" seem to occur much more often once an agent starts operating the shared browser shown in the viewer pane. Does the browser screencast cause them?

## Evidence available on 2026-10-01

From `pi-livecraft-app.log`, 2026-09-09 to 2026-10-01 (8,398 lines):

- **Drops are not backend restarts.** 815 of 817 client `sse-drop` reports had no backend `boot` or `shutdown` within 15 s.
- **Most drops are shared.** Grouped into 464 drop events (reports within 2 s), 256 ended `/api/events` in more than one tab at once. Something common to all tabs — the backend, the Vite proxy, or the transport — ended the streams while the backend kept running.
- **Streams end up `CLOSED`.** Reports carry `state=closed` rather than `connecting`, which for `EventSource` usually means a reconnect received a non-200 response instead of a plain network drop. Recovery took 1,031 ms at the median (the explicit reopen), 11 s at p99, and up to 8 minutes. Before 2026-09-23 a closed stream was never reopened, leaving "connection lost" until reload.
- **The daily rate rose from 2026-09-26** (from 1–28 to 30–99 drop events per day), but the screencast (2026-08-30) and the agent browser skill (2026-09-01) predate the log, and drop reporting changed on 2026-09-23 (reopen plus new fields; 230 older reports lack them). The trend is not evidence either way.
- **No browser activity was recorded.** Capture telemetry and SSE close records were added and reverted on 2026-09-26 (`2573c4a`/`1261ee8`, `e400a26`/`dd1d4ab`) without a recorded reason. The only browser marker left, input sent to a browser that is not live (409), fell within 5 minutes of 3 of 464 drop events; it only occurs while the browser is down, so it says nothing about active use.

Conclusion: the theory could be neither confirmed nor rejected with this data.

## Candidate mechanisms

1. **HTTP/1.1 connection exhaustion.** Chrome allows six connections per origin across all tabs. Each tab holds `/api/events`; each visible Browser pane adds a frames stream; an embedded terminal adds one more. With three tabs showing the browser, no connection remains and every other request queues indefinitely, which matches a view stuck loading its snapshot. It does not explain simultaneous `CLOSED` drops.
2. **Backend event-loop load from the screencast.** Every JPEG frame (quality 60, up to 12 FPS per viewer) is parsed from Chrome's CDP WebSocket and re-sent to each viewer. Frames are dropped when a viewer is 512 KB behind, but `/api/events` has no such limit. Sustained load would delay events and snapshots for every tab.
3. **Livecraft viewing itself.** When an agent opens Livecraft in the shared browser (visual checks do), that page can show its own screencast, repainting continuously, and adds a full client with its own streams and snapshots.

## Instrumentation added 2026-10-01

- Backend [stability monitor](/server/features/diagnostics/README.md#stability-monitor): event-loop delay per 10 s window (`event-loop-lag`), open streams by kind (`stream-pressure`), every `/api/events` closure with lifetime and reason (`sse-close`), and browser capture per minute and state changes (`browser-activity`, `browser-state`).
- Client reports: `sse-drop`, `sse-reopen`, and `connection-stall` carry the tab's open streams and pending requests; `fetch-stall` reports any GET still pending after 15 s.

## How to decide

After the next incident, read the app log around the client reports:

- `fetch-stall` with `pending` ≥ 1 while the tabs' streams add up to six, or a `stream-pressure` entry, supports mechanism 1. DevTools Network showing the request "Stalled/Queueing", or `chrome://net-internals/#sockets` showing the pool at 6/6, confirms it.
- `event-loop-lag` entries during `browser-activity` minutes with high `fps` support mechanism 2.
- `sse-close` with `reason=transport-closed` in every tab at once, with no lag or pressure, points at the proxy or transport rather than the browser.
- Repeat with the Browser pane closed while the agent drives the browser; if the symptoms disappear, the viewer streams are implicated rather than the agent's CDP use.

## Fix directions if confirmed

- Mechanism 1: carry each tab's events, frames, and terminal output on one stream or WebSocket, or serve over HTTP/2, so long-lived streams cannot exhaust the per-origin pool.
- Mechanism 2: move frame relaying off the main event loop or lower capture cost (frame rate, quality, viewport) while an agent drives the browser.
- Mechanism 3: suppress the Browser pane's screencast inside the shared browser itself.
