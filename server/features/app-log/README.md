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
| `sse-open` | SSE stream opened (loads and reconnects) | — |
| `slow-snapshot` | snapshot ≥ 1000 ms | `mode`, `totalMs`, `bytes` |
| `client` | client POST `/api/client-log` | `source`, `message` |
| `client-cap` | client cap reached | `note` (once per run) |

Client sources: `window-error`, `unhandled-rejection`, `fetch-failure` (network errors
and HTTP ≥ 500 only — 4xx is user-visible validation, not instability), `sse-drop`,
`sse-reopen`.

## Policy

- **Retention: none.** The file grows unbounded by explicit decision (2026-09-07):
  handle size later, when real usage shows it matters. Each line is one JSON object
  with `t` (epoch ms) and `kind`.
- **Bounds per entry:** client messages ≤ 300 chars (client truncates at 500 first),
  stacks ≤ 2000 chars, client entries capped at 500 per run with one `client-cap`
  marker.
- **Content-free discipline:** no prompts, payloads, or session identifiers. Client
  exception text is truncated but otherwise verbatim; it may mention file names.
- **Writes are synchronous appends** so the `exit` and crash handlers complete them;
  volume is low (errors, lifecycle, slow snapshots). Append failures are swallowed.
- **Crash semantics:** an uncaught exception logs `uncaught`, writes
  `shutdown {reason: 'crash'}`, then rethrows, keeping the terminal stack trace and
  `node --watch` behavior unchanged. The next `boot` reports that run as
  `clean: false`; a `reason: 'exit'` shutdown reports `clean: true`.
- **Backend restart starts a new segment** — the log itself survives.

Coverage: `test/app-log.test.ts`.
