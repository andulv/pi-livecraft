# Diagnostics

Content-free, in-memory diagnostics for the local backend, consumed by the right-sidebar
Diagnostics widget through `GET /api/diagnostics`. Defined per the performance plan's
observability handoff; nothing here logs payloads, prompts, session ids, or paths.

## Policy

- **Collected:** per-route request counters, the [operation ledger](#operation-ledger), failed-request count, SSE stream openings,
  snapshot totals (full/delta counts and byte totals), and the last stage timings per
  snapshot (RPC phase, individual overlapping RPC waits, active-message build, template reads,
  total, bytes, mode, and concurrent snapshot loads at RPC start).
- **Retention:** ring buffers in memory only — 100 recent events, 50 recent snapshot
  stages, monotonic counters. Nothing is persisted; a backend restart starts empty. Its persistent companion is the [app log](/server/features/app-log/README.md), which survives restarts.
- **Correlation:** each event and stage carries a monotonic `sequence` and wall-clock `t`.
  No cross-request correlation ids beyond that; concurrent loads are counted without
  retaining session identifiers in diagnostic entries.
- **Overhead:** one `Date.now()` plus counter arithmetic per request, and one
  `AsyncLocalStorage` context per request plus map updates per measured operation;
  serialization only happens when `/api/diagnostics` is polled. No timers and no logging
  framework; the only I/O is the app-log append for an operation anomaly.
- **Content safety:** routes are stored as caller-provided templates (session identifiers
  replaced before recording). Entries carry counts, durations, byte totals, modes, and ok
  flags — never request bodies, tool output, prompts, or file paths.

## Stability monitor

[`stability.ts`](stability.ts) samples signals for diagnosing lost connections and views
that never finish loading. Every 10 s window records the backend's event-loop delay (p50,
p99, max from Node's `monitorEventLoopDelay`), the long-lived streams open at that moment
(`events`, `browser-frames`, `browser-socket`, `terminal`, across all clients), and shared-browser capture in
the window (live instances, viewers, frames, bytes; sampled from each session's counters,
never per frame). The last 60 windows (ten minutes) appear as `stability` in
`GET /api/diagnostics` and in the widget's Stability section, with the peak stream count
since backend start.

The app log receives `event-loop-lag` (a window whose worst delay is at least 200 ms),
`stream-pressure` (open streams reach six, logged once per episode), `sse-close` (every
`/api/events` closure with its lifetime and whether the server finished it or the transport
closed), `browser-state` (an instance changed state between windows), and
`browser-activity` (one capture summary per minute that had a viewer or frame). The
stream threshold is Chrome's limit of six HTTP/1.1 connections per origin, shared by all
tabs; because the gauge counts every client, it is an upper bound for one browser. See
[long-lived connections](/docs/DATA-FLOW.md#long-lived-connections).

## Operation ledger

[`operations.ts`](operations.ts) measures every expensive operation at its owning
chokepoint, in both the backend and the manager, and attributes it to the trigger that
caused it. Its purpose is to make fan-out
visible: one UI event that spawns dozens of Git processes shows up as a single trigger with a
large operation count.

| Process | Kind | Chokepoint | `detail` |
|---|---|---|---|
| backend | `git` | `runGit` in `server/features/git/git.ts` (one per spawned process) | subcommand (`status`, `diff`, …) |
| backend | `manager-rpc` | `ManagerClient.request` (round trip, including the manager's work) | manager action, or `command:<type>` for Pi commands |
| backend | `session-store` | `listRecentPiSessions` (whole scan), `loadPiSession` (one file) | `list-recent`, `load` |
| backend | `prompt-templates` | `loadPromptTemplates` | `load` |
| manager | `pi-rpc` | `PiProcess.request` (every Pi RPC, including the manager's own `get_state` reconciliation and isolated prompts) | Pi command type |
| manager | `pi-process` | `PiProcess` constructor (one per started `pi --mode rpc`; duration is spawn latency only) | `session` or `isolated` |
| manager | `project-map` | `generateProjectMap` for prompt improvement | `scan` |

- **Attribution:** `backend.ts` opens one context per HTTP request and runs the handler inside
  `AsyncLocalStorage`, so nested operations inherit its route template (`/api/` dropped,
  session and instance ids masked) and its **cause**. Work outside any request, such as
  manager-event handlers, is labelled `background`. Work started by one request and awaited
  by another (shared in-flight promises) counts for the request that started it.
- **Manager attribution:** `ManagerClient` forwards the current route and cause as the
  manager request's `origin`; the manager runs each request in its own context with that
  origin, so `sessions ← sessions:session_created` names the same trigger in both ledgers.
  Requests from backend background work, and Pi work outside any request, are `background`.
- **Cause:** the frontend names the trigger in the `x-livecraft-cause` header
  (`requestCauseHeader` in `shared/types.ts`). `src/api.ts` requires a `RequestCause`
  (`<area>:<trigger>`, for example `git:tool-end`, `sessions:session_created`) on the
  repeatable reads whose trigger the route cannot reveal — Git snapshot and project, session
  listing, recent sessions, pin resolution, session snapshots, quotas, and environment — so a
  new caller must name its trigger. Other routes are attributed by route alone until they
  gain a cause. Missing
  headers are recorded as `unspecified`; values outside `[A-Za-z0-9:_-]{1,64}` as `invalid`.
  Concurrent identical GETs share one fetch, so only the first caller's cause is recorded.
- **Exposed:** `operations` (backend) and `managerOperations` in `GET /api/diagnostics` —
  `kind:detail` totals (count, failures, total and max ms), `route ← cause` triggers
  (requests that did work, operations), operations currently running, and the newest 40
  entries (ring of 100). The backend reads the manager's ledger through the manager
  `diagnostics` action with a 750 ms timeout and does not measure that read;
  `managerOperations` is `null` while the manager is unreachable or still runs a revision
  without the action (the poll then waits for the timeout until the guarded restart).
- **Persisted anomalies** (to the [app log](/server/features/app-log/README.md)):
  `slow-operation` (≥ 1000 ms), `operation-burst` (once per 10 s window when one kind reaches
  its threshold: Git 40, manager RPC 120, session store 20, prompt templates 20, Pi RPC 150,
  Pi processes 6, project maps 5) and `request-fanout` (one request performing ≥ 20
  operations). Each line carries `process` (`backend` or `manager`). The manager sends its
  anomalies as `operation_anomaly` events; the backend validates them, keeps only known
  fields, writes them as the app log's single writer, and never broadcasts them over SSE.
  Manager anomalies raised while no backend is connected are lost. Thresholds are
  heuristics for finding regressions; adjust them in `operations.ts` when real usage shows
  they are noisy.
- **Manager runtime:** `operations.ts` is declared in `server/manager-runtime-files.json`, so
  editing it marks the manager stale until the user's guarded restart.
- **Bounds and safety:** aggregate maps keep at most 200 keys and fold the rest into `other`.
  Entries never carry paths, arguments, commit messages, or identifiers.

**Adding an expensive operation** (a new process spawn, file scan, or RPC path): wrap
it once at its chokepoint with `measureOperation(kind, detail, run)`, adding a kind to
`OperationKind` only for a new family. A new frontend trigger of such work passes its own
`RequestCause` rather than reusing another trigger's name.

Focused coverage: `test/stability.test.ts` (stream pressure, closures, lag, browser
capture), `test/diagnostics.test.ts` (counters, ring bounds, payload shape),
`test/operations.test.ts` (attribution, cause and origin validation, anomaly parsing, slow,
burst, and fan-out reports), and the `attributes Pi processes and RPCs to the forwarded
request origin` case in `test/manager.integration.test.ts`.
