# Session performance: investigation and work plan

This is a specification, not an implementation guide. It is step one of three:
**performance → logging and observability → stability**. Basic measurements and regression
checks belong in step one. The later steps must not be prerequisites for a safe change.

## Goal and scope

Find why Livecraft becomes slow with many sessions, projects, and workspaces over time.
The cause can be Livecraft, Pi, workspace applications, or shared machine load. Do not assume
that snapshots explain the whole problem.

Reduce unnecessary work during session switches and session-data refreshes. Read only the
data needed by each component. Keep the interface responsive while data loads. Background
loading does not, by itself, reduce total work.

Right-panel persistence and its loading presentation are assigned to another worker. They
are outside this plan. Do not change that worker's files or duplicate that work.

## Evidence and open questions

### Confirmed source behavior at review

- `server/backend.ts` sends seven parallel RPC commands for each snapshot: `get_state`,
  `get_entries`, `get_available_models`, `get_commands`, `get_session_stats`,
  `get_fork_messages`, and `get_available_thinking_levels`. It reconstructs the active
  conversation and loads prompt templates before returning the response.
- `useConversationRuntime` refreshes after several event types, including tool completion,
  message completion, and agent settlement. It already combines concurrent refresh requests,
  delays subsequent requests by 100 ms, and rejects stale responses. Do not add a second
  request scheduler without evidence that the existing one cannot meet the need.
- `get_entries` returns full history. Repeated calls can cost more as history grows. The
  actual bytes, frequency, and cost during active work still need measurement.
- State, stats, and forkable messages are dynamic. Thinking levels depend on the model.
  Models, commands, and templates are cache candidates, not proven static data.
- Workspace selection can require a manager list, a bounded session scan, a Pi reopen,
  a snapshot, Git data, workspace colour, and environment data. Most operations are valid
  once. Duplicate or unnecessary operations must be identified from a trace.
- The session list scans only the selected workspace. The documented scan reads head 8 KB
  and tail 16 KB from at most 30 files. Pins resolve by stored path. Preserve these bounds.
- Structural manager events can refresh the selected project's list even when unrelated.
  `session_created` carries a session summary. `session_reassigned` carries the old session
  ID and `data.newSessionId`, not a workspace path.
- The index traverses messages and also uses observed request durations. A cache key based
  only on the last message ID and message count is not sufficient.
- Automatic snapshot refreshes are not gated by page visibility.

These are the starting contracts. Other workers can change source during this project.
Record the tested revision and relevant working-tree changes before using these findings.

### Earlier measurements

The original investigation reports a 30-second idle sample in software-rendered viewer
Chrome. Before the status-animation fix it found 1,784 style recalculations and about 56%
GPU-process CPU plus 22% renderer CPU. After the discrete pulse it found 60 recalculations
and near-idle GPU-process CPU. Backend and manager CPU were below 5% while idle.

These results concern the earlier idle animation problem. They do not establish the main
active-work bottleneck. Raw traces and the original sampling method are not included here.

### Questions to resolve

1. Which process or operation consumes the time when the user sees a slowdown?
2. Does cost depend on history size, live process count, application load, or elapsed time?
3. Which switch requests repeat without a data change?
4. Is the main snapshot cost RPC, conversion, transfer, parsing, or rendering?
5. Does memory return to a stable range after work stops and switches finish?

## Work order A — measure before changing behavior

### A1. Safety and setup

1. Read repository instructions and the guide for the area under test. Load the
   `livecraft-browser` skill before browser work. Use only the shared Livecraft browser.
2. Record the commit, relevant local changes, date, OS, CPU count, Node/Pi/browser versions,
   development or production mode, and whether Chrome uses software rendering. Record
   process uptime, tab count, live Pi count, projects, workspaces, and workspace applications.
   Do not dump environment variables, full command lines, credentials, or session content.
3. Coordinate with other workers. Keep source and settings fixed during each measurement
   batch. Discard and repeat a batch if a hot reload or another worker's change affects it.
4. Use approved disposable sessions and workspaces for prompts and switching tests. Ask
   before paid model calls, new network workloads, stopping applications, deleting data,
   or any disruptive action. Never restart the manager or supervisor. Do not restart the
   backend to get a clean baseline: it owns terminals and browser instances.
5. Observe the existing long-running setup before any permitted reset. A browser reload is
   not a fresh manager or Pi run. Label each process age separately. If a fresh comparison
   needs a disruptive reset, report it as blocked and request approval.
6. Keep raw traces in a local temporary directory outside Git. Use aliases for projects and
   sessions. Do not retain request bodies, tool output, prompts, or response content. CDP
   URLs and traces can contain private paths; sanitize them before sharing.

### A2. Workload matrix

Use the same browser viewport, selected widget, conversation display mode, and application
load for each before/after pair. Inventory existing session sizes by file size and snapshot
message count; do not scan all history just to classify it. Select a short and a long session
from the available workload. Report actual sizes, not just labels.

Run these cases in both the available fresh/light setup and the aged/busy setup. If a case
is unavailable, state that limitation instead of creating large workloads without approval.

| Case | Procedure |
|---|---|
| Visible idle | Leave the same session selected for 60 seconds. Do not interact. |
| Hidden idle | Hide the Livecraft tab for 60 seconds, then restore it. Verify `document.visibilityState`; viewer occlusion alone is not proof. |
| Active turn | Use one approved, repeatable prompt with several tool calls. Record event counts and output size because model runs can differ. Repeat three times where approved. |
| Session switch | Alternate two already-live sessions in one workspace 20 times. Wait for data to settle between selections. |
| Workspace switch | Alternate two workspaces in one project 20 times. Distinguish live-session selection from Pi reopen. |
| Rapid selection | Select A, B, then A before requests finish. Repeat five times. Check that only A's data is applied. |
| Multi-project | Observe two project tabs while an approved structural session event occurs in one project. Count list requests in both. |
| Hidden active | Hide the tab during an approved active turn for 60 seconds. Restore it and check history, status, tools, and queue state. |
| Long-run sample | Sample normal approved use for at least 30 minutes, then five minutes idle. Repeat the switch batch near the start and end. This is a growth screen, not proof about multi-day use. |

For short cases, capture three repetitions. Separate the first cold selection from warm
selections. Do not manufacture a cold run by clearing user caches or session data. For a
small sample, report count, median, range, and individual slow cases; report p95 only when
there are at least 20 observations. Record unrelated background activity.

### A3. What to measure and how

**Process cost**

- Use a local sampler at one-second intervals. On Linux, read `/proc/<pid>/stat` CPU ticks
  and RSS from `/proc/<pid>/status`; read the clock tick rate with `getconf CLK_TCK`.
  CPU percent is `100 × delta CPU ticks / ticks per second / elapsed seconds`.
  This convention makes one fully used core 100%; report the convention.
- Identify processes by parent PID and safe labels. Sample backend, manager, each Pi,
  Chrome browser/renderer/GPU processes, and workspace application process trees separately.
  Include machine CPU, available memory, and swap activity when available with existing tools.
- Keep per-process results and group totals. Do not double-count descendants. Record exits
  and restarts; use PID plus start time so PID reuse cannot corrupt the sample. RSS totals
  can double-count shared pages: label this limit and do not call them unique memory usage.
- Compare idle memory before and after switch batches and the long-run sample. A rising
  RSS alone does not prove a leak. Look for retained heap, DOM nodes, listeners, or growing
  cache counts when evidence points to that owner.

**HTTP and switch cost**

- Use shared-browser CDP Network events to collect request start, completion, status,
  encoded transfer bytes, and decoded body bytes where available. Keep only route patterns,
  safe session aliases, timings, and sizes. Count cached, failed, and cancelled requests
  separately. Do not download response bodies for the report.
- Count all requests per switch, especially session list/resolve, snapshot, Git, environment,
  and project discovery. Record order, overlap, and repeated requests for the same selection.
- Mark selection time, selected-session header update, correct conversation display, and
  completion of required widget data separately. Use browser performance marks or a bounded
  trace; state exactly how each completion was detected. Do not use global network-idle as
  completion: SSE and other persistent connections stay open.
- Count snapshot requests per active turn and per triggering event type. Record maximum
  in-flight requests and requests whose responses are ignored after a selection change.

**Snapshot stages**

- Start with browser timings. If they cannot separate the suspected cost, add minimal,
  temporary timing probes at the owning backend route, in coordination with its worker.
  Backend edits can trigger a restart; obtain approval before applying probes to the live
  setup. Use a permitted test setup otherwise. Do not instrument manager runtime files.
- Give each measured snapshot an ephemeral correlation ID. Use monotonic clocks to measure
  each of the seven RPC waits, total parallel RPC wall time, active-message reconstruction,
  response-controls derivation, template reads, JSON serialization, and total route time.
  Count entries/messages and serialized bytes without recording their content. Avoid extra
  serialization just to measure size. Label serialization time unavailable if it cannot be
  measured without a larger change.
- RPCs run in parallel: do not sum their durations as route latency. Backend RPC waits include
  transport, queueing, and Pi work; they are not direct Pi CPU measurements. Correlate them
  with process samples before attributing cost to Pi.
- Keep probes local, bounded, and content-free. Record their overhead with a short unprobed
  comparison. Do not add a permanent logging framework or expose a diagnostic endpoint.

**Browser work**

- Take CDP performance metric deltas around each case: script duration, task duration,
  layout/style counts and duration, DOM nodes, and JS heap use where supported.
- Capture a bounded Performance trace for one representative slow switch and active turn.
  Locate long main-thread tasks and time in parsing, message reconciliation, index calculation,
  and rendering. If React profiling is available, record commit count and duration. Otherwise
  report browser task timings; do not label them React commit timings.
- Use paired samples to check profiler overhead. Do not leave tracing on for the long-run
  sample. Do not force garbage collection during normal timings. Any separate retained-heap
  experiment must state its method and privacy limits.

### A4. Required report and decision gate

Return a sanitized report with:

1. Setup, exact reproduction steps, sample counts, process ages, and unavailable cases.
2. A table per case: request counts/bytes, latency, process CPU/RSS, browser task time,
   and correctness failures. Include baseline variability and cold/warm results.
3. A switch request timeline and snapshot-stage breakdown for the slowest representative case.
4. Ranked causes with measured evidence, confidence, and the smallest proposed change.
5. A clear distinction between Livecraft cost, Pi cost, application load, and unassigned cost.
6. Commands/scripts and local artifact locations needed to repeat the measurements. Do not
   commit raw traces or private workload data.

Proceed to work order B only for a supported cause. Select a numeric target for its primary
metric from this baseline before editing. Repeat the same cases after the change. Claim an
improvement only when it exceeds baseline variation and correctness checks pass. Report
unchanged or worse metrics too. If the dominant cost is outside Livecraft, report the owner
and the next diagnostic step rather than add speculative Livecraft caches.

## Work order B — remove unnecessary work

Implement one bounded change at a time. Do not run these tasks as independent parallel
edits: they share request and state ownership. Coordinate with the panel worker before any
change to `App.tsx` or loading-state props.

### B1. Reduce duplicate refreshes and switch initialization

Owners: `src/features/conversation/useConversationRuntime.ts`,
`src/features/workspace/useWorkspaceSessions.ts`, and cross-feature effects in `src/App.tsx`.
All HTTP calls must continue through `src/api.ts`.

1. Use A's trace to map each repeated request to its caller, event, selected session/workspace,
   and data dependency. Separate a necessary follow-up reconciliation from a duplicate.
2. Extend the existing refresh scheduler if needed. Keep at most one in-flight automatic
   snapshot per selected session. Combine a burst into one pending refresh; do not replay
   one request for each queued event. Events during a fetch can still require a follow-up.
3. Preserve immediate selection loading, explicit user refresh, final settled-state
   reconciliation, error reporting, live-event replay, and stale-response rejection.
   Inspect callers that await `refreshSnapshot` before changing when its promise resolves;
   queue reconciliation already uses that promise.
4. On a switch, fetch workspace data only when that workspace dependency changes. Fetch
   session data for the new session. Reuse existing controller state rather than add a
   second cache. Keep Pi reopen when required. Remove only work proven redundant.
5. Keep independent required requests parallel where safe. Do not delay the conversation
   behind unrelated Git or environment work. Do not move lifecycle ownership into `App`.

Proof: controlled delayed-request tests for an event burst, an event during a fetch, final
settlement, failed fetch/retry, and A→B→A selection. Assert request counts, bounded concurrency,
correct applied data, and promise behavior. Repeat A's switch and active-turn measurements.
Start with `test/conversation-runtime.test.ts`; locate the nearest workspace/controller test
for switch behavior, or add a focused regression at that owner if none exists.

### B2. Suspend automatic snapshots while hidden

Owner: the existing conversation runtime scheduler, not each widget.

1. Track visibility with `visibilitychange`. Confirm the hidden state with `document.hidden`.
2. While hidden, suppress new automatic snapshot requests and mark the selected session
   dirty. Keep SSE processing and required non-snapshot state handling intact.
3. Let an existing request finish safely. Prevent its scheduled follow-up from starting
   while hidden. Do not start a hidden polling loop.
4. On visibility return, request one reconciliation for the current session if dirty. Use
   the same scheduler so visibility and settlement events cannot launch parallel requests.
   Events during this request can mark it dirty again.
5. Preserve initial selection and explicit-command refresh semantics. Define these exceptions
   in tests. Do not report a skipped request as fresh data to an awaiting caller.
6. Clean up listeners and pending work on unmount and selection change. Never apply a
   hidden session's old result to a new selection.

Proof: tests for hide during debounce, hide during fetch, repeated hidden events, visible
recovery, selection while hidden, failure, and unmount. After an in-flight request completes,
hidden automatic events must start zero snapshots. On return, one catch-up request starts
when dirty, unless new events require a follow-up. Test real tab visibility with the shared
browser and verify messages, tools, queue state, and status after recovery.

### B3. Scope session-list events safely

Owners: App's manager-event subscription and the workspace controller's existing list state.

1. For `session_created`, compare the summary's workspace with this project's known workspace
   set. Use existing path identity rules, not a string-prefix comparison.
2. For `session_reassigned`, use known old/new session membership. The event has no `cwd`.
   Refresh if either belongs to this project. Skip only when unrelated ownership is known;
   retain a safe refresh when ownership cannot be determined.
3. Keep `manager_connected` global. Preserve rename, explicit refresh, workspace selection,
   and current-session reassignment behavior. A session exit must not become a full scan.
4. Do not add an event field or change manager runtime for this task. If available membership
   cannot support a useful filter, report that limit and defer the protocol proposal.
5. Keep the selected-workspace scan bounds and direct pin resolution unchanged.

Proof: tests for relevant, unrelated, and unknown ownership; missing optional data; reassignment
of the selected session; and reconnect. With two project tabs, a known unrelated creation
must not trigger the other project's list scan. Unknown reassignment must still reconcile.

### B4. Cache metadata only with a complete freshness policy

Owner: snapshot assembly in `server/backend.ts` and its existing template loader. Start only
if A shows material metadata cost. Do not cache full history as part of this task.

1. Keep `get_state`, `get_entries`, `get_session_stats`, and `get_fork_messages` fresh.
   Do not rely on `session_info_changed` to invalidate model, streaming, queue, or history data.
2. For each proposed cache item, write a policy table before coding: key, source, dependencies,
   invalidation trigger, fallback expiry if needed, acceptable stale interval, maximum retained
   size/count, and cleanup owner. If freshness cannot be guaranteed within an acceptable
   interval, leave that item uncached.
3. Evaluate models, commands, model-dependent thinking levels, and prompt templates separately.
   Account for model changes, command/resource reloads, template edits, and workspace/session
   identity. A single session-level cache entry is not a sufficient policy for all these data.
4. Clear applicable entries on exit, reassignment, and manager disconnect/reconnect. A backend
   restart starts with an empty cache. Bound retention for sessions that remain live for days.
5. Combine concurrent loads for the same key. Do not cache failures as successful empty data.
   Prevent an old in-flight load from repopulating an invalidated entry. Preserve response shape.

Proof: cache hit/miss and concurrency tests, invalidation during a pending load, model/resource
change, template edit, exit, reassignment, reconnect, expiry, eviction, and failure/retry as
applicable to the selected items. Use the nearest backend route tests; pure reconstruction
coverage in `test/session-snapshot.test.ts` alone does not prove route caching. Repeat stage
latency and memory measurements. Verify unchanged state and forkability after a new prompt.

### B5. Keep loading correct without duplicating panel work

Use the loading-state contract supplied by the panel worker. If another consumer needs new
state, agree on ownership before editing. Distinguish initial loading, background refresh,
empty data, and error. Retain usable same-session content during refresh. Do not label old
session content as current. One request failure must not leave an endless loading indicator.
Load the `livecraft-ui` skill before any visual change. This task does not reintroduce the
excluded panel-persistence fix.

## Deferred changes — require new evidence and a separate design

### Incremental snapshot messages (implemented 2026-09-07, commit c2a3bec)

The A report showed full snapshots at 1.5–2 MB on every selection and settle, so this
change left the deferred list with the design below, which it follows.

Implemented as designed: visible messages are stamped with their snapshot `entryId`
(additive field); `GET /api/sessions/:id/snapshot?since=<count>:<last entryId>` returns a
`mode: 'delta'` response with only appended messages plus fresh metadata, and a `cursor`
for the next request. The server validates the cursor against the current active chain;
compaction, a branch change, or an unknown cursor falls back to a full snapshot. Clients
without `since` still receive full snapshots. The client merges deltas and reuses the
previous messages array when nothing was appended, so unchanged settles do not re-render.
No manager or Pi RPC change was made. `get_entries` still ships full history per request:
Pi-side history reads are not reduced, as stated above.

Measured on a 1.5 MB session: warm settles returned 198 KB (metadata only; history bytes
gone); invalid cursor returned the full 879-message snapshot. Focused coverage lives in
`test/session-snapshot.test.ts` (append, unchanged, unknown/moved/oversized cursor,
shrunk history) and `test/conversation-runtime.test.ts` (merge identity and full
replacement). Residual: delta responses still re-send metadata (models, commands,
templates) — that is B4's remaining case, and it now owns most of the delta bytes.

Original design notes kept for reference:

Consider only if full snapshots remain a measured cost after B. Browser deltas can reduce
HTTP transfer and parsing but do not eliminate full-history `get_entries` RPC calls. Do not
claim a reduction in Pi-side history reads unless it is separately demonstrated.

Before implementation, define an additive HTTP contract in `shared/types.ts` and `src/api.ts`:
explicit full/delta mode, session identity, base and next cursor, reset rules, and current
metadata/live-event handling. Existing clients must still receive full snapshots by default.

Visible messages do not currently all expose their entry IDs. Define cursor mapping rather
than assume message IDs exist. Validate a cursor against the current active chain, not just
an old cached entry list. Specify replacement when the client's prefix is no longer valid.
Compaction does not necessarily remove old visible history in Livecraft. Test both retained
history and invalid-prefix cases.

Preserve event sequence deduplication, live replay, final-message reconciliation, and stale
response rejection. Test append, unchanged history, branch/fork changes, compaction, unknown
cursor, reconnect, overlapping requests, and rapid selection. Bound retained cache memory.
No manager or Pi RPC change is authorized by this plan.

Implemented alongside it (commit 88c19e9): the manager-event subscription no longer
resubscribes when workspace-dependent handlers change identity. A's workspace-switch case
measured one `/api/events` reconnect per switch; after the change, six switches produced
zero reconnects.

### Session-index optimization

Start only if profiling still shows material index cost. Preserve message identity when data
is unchanged where practical. Any memoization must include session identity, actual message
changes, and observed-duration telemetry. Do not use only last message ID plus count.
Use `test/session-index.test.ts` for correctness and the same long-session browser case for
performance. Avoid a new incremental index data structure without evidence it is needed.

## Validation and completion

- Documentation-only changes need targeted review and formatting validation.
- For TypeScript changes, run `npm run lint`, the nearest focused tests, and
  `npm run typecheck`. Use `npm test -- test/conversation-runtime.test.ts` for runtime changes;
  select additional tests only for affected behavior. Do not launch paid integration runs
  or external documentation evaluations without approval.
- After each change, repeat the affected A cases with the same setup. Check request counts,
  latency, memory, and correct state, not only visual responsiveness.
- Stop adding optimizations when measured targets are met. Record residual costs and limits.
  Do not call the long-running problem fixed based only on one short browser trace.
- Preserve pre-existing work. Stage and commit only task-owned changes after checks pass.
  Do not commit raw profiles, user data, temporary probes, or unrelated worker changes.

## Close-out validation (2026-09-07)

Validation performed after the B changes; sanitized raw traces stay outside Git.

- **Delta correctness** — unit tests cover append, unchanged history, unknown/moved/oversized
  cursors, and shrunk (compacted) history. Live: 10 cross-session switches returned full
  snapshots by design (2 requests each, median visible completion 277 ms); rapid selection
  (15 clicks) coalesced to 11 snapshots with the correct final state; a warm settle returned
  a 201 KB delta against a 2.0 MB full baseline. A live backend-restart reconnect test was
  not run (it kills the viewer browser); reconnect correctness rests on server-side chain
  validation plus client version rejection.
- **Repeated measurements** — switch request counts unchanged and clean; warm-settle bytes
  2.0 MB → ~200 KB; renderer CPU 23–35 % during mixed work (settle renders plus always-on
  activity animations under software raster remain the dominant residual).
- **Hidden-active recovery** — verified with the existing running session: zero snapshot
  requests while the tab was hidden, exactly one catch-up delta (~200 KB) on return,
  history, session name, and activity state correct.
- **30-minute growth sample** — 31 minutes of mixed real use plus a 5-minute idle tail:
  backend/manager/Pi CPU ≤ 0.7 % with flat RSS; app renderer RSS fell 1534 → 893 MB; host
  CPU 9.9 % average. No growth signature in any Livecraft or Pi process.

Task status: A complete. B1 closed by evidence (no duplicates). B2, delta payloads, and the
subscription fix done (commits 6f11890, c2a3bec, 88c19e9). B3 deferred (single registered
project cannot exercise it). B4 deferred → recommended next (delta metadata is now most of
the remaining warm-settle bytes). B5 owned by the panel worker. Ready for the observability
step; do not add caching beyond B4 without a new measurement.

## Handoff to the next two project steps

**Logging and observability:** use the useful measurements from A to define content-free,
bounded diagnostics: request counts, stage durations, errors, cache hit/miss/eviction, and
reconnects. Define retention, correlation, and overhead before permanent instrumentation.

**Stability:** extend regression coverage with longer runs, repeated switches, reconnects,
failed requests, and listener/cache cleanup. Carry forward any unexplained growth with its
reproduction steps. Fault injection that disrupts live services needs separate approval.

## Related contracts

- [Architecture](/docs/ARCHITECTURE.md) — layer ownership and restart effects.
- [Talk to Pi](/docs/HOW-TO-TALK-TO-PI.md) — snapshot and public RPC boundary.
- [Conversation](/src/features/conversation/README.md) — reconciliation and runtime owner.
- [Workspace and sessions](/src/features/workspace/README.md) — selection and bounded lists.
