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
| `request-error` | failed HTTP request | `route` (template, `sessions/:id` masked), `status` |
| `manager` | manager connect/disconnect | `state` |
| `sse-open` | Backend SSE stream opened (loads and reconnects) | `connection` (process-local number) |
| `sse-close` | Backend SSE response closed | `connection`, `lifetimeMs`, `reason` (`finished` / `transport-closed`) |
| `browser` | Browser start/live/stop/crash, first/last cast viewer, or at most one capture sample per active minute | process-local `instance`, `event`, `viewerCount`, cumulative `capturedFrames`, `capturedBytes` |
| `slow-snapshot` | successful snapshot ≥ 1000 ms | `mode`, `rpcMs`, `buildMs`, `templatesMs`, `totalMs`, `bytes`, `rpcWaitMs`, `sameSessionInFlight`, `totalInFlight` |
| `snapshot-failure` | one failed Pi snapshot load | first failing RPC name (`rpc`), `durationMs`, `sameSessionInFlight` — no error text |
| `provider-failure` | Pi provider request failed | `model`, `message` (truncated) |
| `client` | client POST `/api/client-log` | `source`, `message` |
| `client-cap` | client cap reached | `note` (once per run) |

Client sources: `window-error`, `unhandled-rejection`, `fetch-failure` (network errors
and HTTP ≥ 500 only — 4xx is user-visible validation, not instability), `sse-drop`,
`sse-reopen`, `session-reconcile`, and `connection-stall`. Every client message begins with a random, page-lifetime
`view=<8 hex digits>` token to correlate reports across open tabs without identifying a project,
workspace, or Pi session. Manager-stream drops and recoveries include browser visibility, EventSource `readyState`
(`connecting`, `open`, or `closed`), and time since the last valid SSE frame. That interval can also mean an idle stream; it is not proof
of a broken connection. The recovery duration uses wall-clock time, so laptop suspension counts.
Repeated EventSource retry errors during the same outage stay silent.
The server-side `sse-open`/`sse-close` connection number pairs the two entries within one
backend run, without identifying the browser tab. `finished` means the backend ended its
response; `transport-closed` means it did not. Neither identifies whether the browser,
proxy, or network ended the connection. A backend process exit may have no `sse-close`;
use the shutdown/boot entries instead.

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
- **Writes are synchronous appends in the backend process**, not a separate worker.
  They can briefly block the event loop, especially on a slow disk. Browser samples
  write at most once per active browser minute; no frame data or per-frame logs are
  written. The log still grows without rotation, and append failures are swallowed
  rather than interrupting requests or casting.
- **Crash semantics:** an uncaught exception logs `uncaught`, writes
  `shutdown {reason: 'crash'}`, then rethrows, keeping the terminal stack trace and
  `node --watch` behavior unchanged. The next `boot` reports that run as
  `clean: false`; a `reason: 'exit'` shutdown reports `clean: true`.
- **Backend restart starts a new segment** — the log itself survives.

Coverage: `test/app-log.test.ts`.
