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

## Operation ledger

[`operations.ts`](operations.ts) measures every expensive backend operation at its owning
chokepoint and attributes it to the trigger that caused it. Its purpose is to make fan-out
visible: one UI event that spawns dozens of Git processes shows up as a single trigger with a
large operation count.

| Kind | Chokepoint | `detail` |
|---|---|---|
| `git` | `runGit` in `server/features/git/git.ts` (one per spawned process) | subcommand (`status`, `diff`, …) |
| `manager-rpc` | `ManagerClient.request` | manager action, or `command:<type>` for Pi commands |
| `session-store` | `listRecentPiSessions` (whole scan), `loadPiSession` (one file) | `list-recent`, `load` |
| `prompt-templates` | `loadPromptTemplates` | `load` |

- **Attribution:** `backend.ts` opens one context per HTTP request and runs the handler inside
  `AsyncLocalStorage`, so nested operations inherit its route template (`/api/` dropped,
  session and instance ids masked) and its **cause**. Work outside any request, such as
  manager-event handlers, is labelled `background`. Work started by one request and awaited
  by another (shared in-flight promises) counts for the request that started it.
- **Cause:** the frontend names the trigger in the `x-livecraft-cause` header
  (`requestCauseHeader` in `shared/types.ts`). `src/api.ts` requires a `RequestCause`
  (`<area>:<trigger>`, for example `git:tool-end`, `sessions:session_created`) on the
  repeatable reads whose trigger the route cannot reveal — Git snapshot and project, session
  listing, recent sessions, and pin resolution — so a new caller must name its trigger. Other
  routes are attributed by route alone until they gain a cause. Missing
  headers are recorded as `unspecified`; values outside `[A-Za-z0-9:_-]{1,64}` as `invalid`.
  Concurrent identical GETs share one fetch, so only the first caller's cause is recorded.
- **Exposed:** `operations` in `GET /api/diagnostics` — `kind:detail` totals (count,
  failures, total and max ms), `route ← cause` triggers (requests that did work, operations),
  operations currently running, and the newest 40 entries (ring of 100).
- **Persisted anomalies** (to the [app log](/server/features/app-log/README.md)):
  `slow-operation` (≥ 1000 ms), `operation-burst` (once per 10 s window when one kind reaches
  its threshold: Git 40, manager RPC 120, session store 20, prompt templates 20) and
  `request-fanout` (one request performing ≥ 20 operations). Thresholds are heuristics for
  finding regressions; adjust them in `operations.ts` when real usage shows they are noisy.
- **Bounds and safety:** aggregate maps keep at most 200 keys and fold the rest into `other`.
  Entries never carry paths, arguments, commit messages, or identifiers.

**Adding an expensive operation** (a new process spawn, file scan, or manager RPC path): wrap
it once at its chokepoint with `measureOperation(kind, detail, run)`, adding a kind to
`OperationKind` only for a new family. A new frontend trigger of such work passes its own
`RequestCause` rather than reusing another trigger's name.

Focused coverage: `test/diagnostics.test.ts` (counters, ring bounds, payload shape) and
`test/operations.test.ts` (attribution, cause validation, slow, burst, and fan-out reports).
