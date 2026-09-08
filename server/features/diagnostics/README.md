# Diagnostics

Content-free, in-memory diagnostics for the local backend, consumed by the right-sidebar
Diagnostics widget through `GET /api/diagnostics`. Defined per the performance plan's
observability handoff; nothing here logs payloads, prompts, session ids, or paths.

## Policy

- **Collected:** per-route request counters, failed-request count, SSE stream openings,
  snapshot totals (full/delta counts and byte totals), and the last stage timings per
  snapshot (RPC wait, active-message build, template reads, total, bytes, mode).
- **Retention:** ring buffers in memory only — 100 recent events, 50 recent snapshot
  stages, monotonic counters. Nothing is persisted; a backend restart starts empty. Its persistent companion is the [app log](/server/features/app-log/README.md), which survives restarts.
- **Correlation:** each event and stage carries a monotonic `sequence` and wall-clock `t`.
  No cross-request correlation ids beyond that.
- **Overhead:** one `Date.now()` plus counter arithmetic per request; serialization only
  happens when `/api/diagnostics` is polled. No I/O, no timers, no logging framework.
- **Content safety:** routes are stored as caller-provided templates (session identifiers
  replaced before recording). Entries carry counts, durations, byte totals, modes, and ok
  flags — never request bodies, tool output, prompts, or file paths.

Focused coverage: `test/diagnostics.test.ts` (counters, ring bounds, payload shape).
