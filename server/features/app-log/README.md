# App log

Append-only JSONL log at the repository root (`pi-livecraft-app.log`, gitignored via
`*.log`). It is the persistent companion to the in-memory
[diagnostics](/server/features/diagnostics/README.md): its purpose is post-hoc stability
analysis — use Livecraft normally, and when errors or instability appear, read the log
and work from that evidence instead of simulating heavy usage.

## Recorded kinds

| Kind | Trigger | Fields |
|---|---|---|
| `boot` | backend start | `pid`, `previousRun` (`{uptimeMs, clean}` or `'unknown'`) |
| `shutdown` | run ends; first write wins | `reason` (`exit` / `crash`), `uptimeMs` |
| `uncaught` | `uncaughtException` / `unhandledRejection` | `source`, `message`, `stack` |
| `request-error` | failed HTTP request with status ≥ 500 | `route` (template, e.g. `sessions/:id/snapshot`; fixed routes like `sessions/recent` stay whole), `status`. 4xx validation failures are counted in diagnostics only |
| `manager` | manager connect/disconnect | `state` |
| `sse-open` | SSE stream opened (loads and reconnects) | — |
| `slow-snapshot` | successful snapshot ≥ 1000 ms | `mode`, `rpcMs`, `buildMs`, `templatesMs`, `totalMs`, `bytes`, `rpcWaitMs`, `sameSessionInFlight`, `totalInFlight` |
| `slow-operation` | one measured operation ≥ 1000 ms | `process` (`backend`/`manager`), `operation` (kind), `detail`, `route`, `cause`, `durationMs`, `ok`, `inFlight` |
| `operation-burst` | one operation kind reaches its threshold within 10 s (once per window) | `process`, `operation` (kind), `count`, `windowMs`, `topTriggers` (`route ← cause` with operation counts) |
| `request-fanout` | one request performed ≥ 20 operations | `process`, `route`, `cause`, `operations`, `byKind`, `durationMs` |
| `event-loop-lag` | a 10 s window whose worst backend event-loop delay is ≥ 200 ms | `p50Ms`, `p99Ms`, `maxMs`, `windowMs`, `streams` (open by kind), `browserFrames` |
| `stream-pressure` | open long-lived streams reach 6 (once per episode) | `open`, `byKind` (`events`, `browser-frames`, `terminal`) |
| `sse-close` | an `/api/events` stream closed | `lifetimeMs`, `reason` (`transport-closed` / `server-finished`), `open` (remaining streams by kind) |
| `browser-state` | a shared-browser instance changed state between samples | `from`, `to` |
| `browser-activity` | once per minute with any viewer or captured frame | `live`, `maxViewers`, `frames`, `bytes`, `fps`, `durationMs` |
| `snapshot-failure` | one failed Pi snapshot load | first failing RPC name (`rpc`), `durationMs`, `sameSessionInFlight` — no error text |
| `provider-failure` | Pi provider request failed | `model`, `message` (truncated) |
| `client` | client POST `/api/client-log` | `source`, `message` |
| `client-cap` | client cap reached | `note` (once per run) |

Client sources: `window-error`, `unhandled-rejection`, `fetch-failure` (network errors
and HTTP ≥ 500 only — 4xx is user-visible validation, not instability), `sse-drop`,
`sse-reopen`, `session-reconcile`, `connection-stall`, and `fetch-stall`. `sse-drop`, `sse-reopen`,
`connection-stall`, and `fetch-stall` end with the tab's connection load:
`streams=e<events>/f<browser frames>/t<terminal>; pending=<requests awaiting a response>; oldestPendingMs=<age>`.
`fetch-stall` reports a GET that is still pending after 15 s, once, with its route template
(no query or identifiers); POSTs are excluded because prompt runs, quota refreshes, push, and
pull are legitimately slow. A report is itself a request, so while connections are exhausted
it arrives late rather than not at all. Every client message begins with a random, page-lifetime
`view=<8 hex digits>` token to correlate reports across open tabs without identifying a project,
workspace, or Pi session. Manager-stream drops and recoveries include browser visibility, EventSource `readyState`
(`connecting`, `open`, or `closed`), and time since the last valid SSE frame. That interval can also mean an idle stream; it is not proof
of a broken connection. The recovery duration uses wall-clock time, so laptop suspension counts.
Repeated EventSource retry errors during the same outage stay silent.

`session-reconcile` reports one selected-session recovery on a detected reconnect, or on
returning to a tab that was hidden for at least 10 seconds, received appended messages, or
could not apply its snapshot. It includes reason, elapsed hidden and snapshot times, counts of selected Pi events and settle
events handled while hidden (which can include snapshot replay), time since the last selected Pi
event and manager SSE frame, result (`applied`, `failed`, or `stale`), message count (appended messages for delta, returned history for full), and Pi streaming status.
`connection-stall` is sent once when the in-conversation cable label remains current for at
least ten seconds in an existing view, including a background tab. It distinguishes a connecting backend SSE transport from
a session still starting and includes the browser's EventSource state, session status (not ID),
visibility, and stream silence. The timer is not a heartbeat and says nothing about Pi work.

A fetch failure while the backend is unreachable cannot be reported until a later successful
request; a page reload loses the old page's token and pending report.

`rpcWaitMs` records individual waits for state, entries, stats, models, commands, fork messages,
and thinking levels. These waits overlap and include queueing/cache lookup; **do not sum them**
or equate them with Pi CPU. `sameSessionInFlight` and `totalInFlight` count concurrent snapshot
loads at the beginning of the RPC phase; they do not identify a session or tab.

## Policy

- **Retention: none.** The file grows unbounded by explicit decision (2026-09-07):
  handle size later, when real usage shows it matters. Each line is one JSON object
  with `t` (epoch ms) and `kind`.
- **Bounds per entry:** client messages ≤ 300 chars (client truncates at 500 first),
  stacks ≤ 2000 chars, client entries capped at 500 per run with one `client-cap`
  marker.
- **Content-free discipline:** no prompts, payloads, project paths, or Pi session identifiers
  in new diagnostic fields. The view token is random and never persisted across reloads. Client
  exception text is truncated but otherwise verbatim; it may mention file names.
- **Writes are synchronous appends** so the `exit` and crash handlers complete them;
  volume is low (errors, lifecycle, slow snapshots). Append failures are swallowed.
- **Crash semantics:** an uncaught exception logs `uncaught`, writes
  `shutdown {reason: 'crash'}`, then rethrows, keeping the terminal stack trace and
  `node --watch` behavior unchanged. The next `boot` reports that run as
  `clean: false`; a `reason: 'exit'` shutdown reports `clean: true`.
- **Backend restart starts a new segment** — the log itself survives.

Coverage: `test/app-log.test.ts`.
