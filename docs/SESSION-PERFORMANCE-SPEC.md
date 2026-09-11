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

### B4. Cache metadata only with a complete freshness policy (implemented 2026-09-07)

Implemented per the policy table in
[`server/features/session-metadata/README.md`](/server/features/session-metadata/README.md):
models, commands, model-keyed thinking levels, fork messages, and prompt templates are
cached per session (LRU, 20 sessions, 60 s fallback expiry); state, entries, and stats
stay fresh. Invalidation covers model change, save-template, session exit/reassignment,
and manager disconnect/reconnect; loads are combined per key; failures are not cached.
Measured: `templatesMs` ~0.02 ms on hits and 4 metadata RPCs skipped per warm snapshot
(20 hits / 5 misses live); diagnostics gained cache hit/miss counters. The warm-delta
payload still carries metadata (~198 KB) because the response shape is preserved —
trimming it further is a separate contract change.

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

## Work order C — remove wasted renders while Pi streams (measured 2026-09-11)

A and B reduced snapshot bytes and hidden-tab work. Neither changed how often the interface
re-renders while Pi streams a turn. C owns that cost. Its measurements are new: treat them as
this work order's baseline, not as a continuation of A's numbers.

### C0. Measured baseline

Tested revision: the A/B close-out tree plus uncommitted `docs/SUBAGENT-SPEC.md` and
`AUDIT-RESPONSE.md`. Vite development server on `127.0.0.1:5173`, React development build,
software-rendered shared Chrome, a second client attached to a live session of 36 visible
messages and 61 tool calls. Backend 5.6 % and manager 4.2 % CPU throughout. CPU convention:
one fully used core is 100 %.

| Phase | Main thread blocked | Long tasks | Median | Max | DOM mutations |
|---|---|---|---|---|---|
| Streaming | 42 % | 66 / 40 s | 154 ms | 1400 ms | 221 |
| Idle | 8 % | 12 / 31 s | 229 ms | 373 ms | 50 |

Spending 42 % of the main thread to commit 221 mutations is the signature of discarded work.
The cost is render and reconciliation, not DOM, paint, parsing, or transfer.

A 45-second sampling profile attributes self time as follows.

| Self | Symbol | Reading |
|---|---|---|
| 9.0 % | `jsxDEV` / `jsxDEVImpl` | React element creation dominates every other cost |
| 2.7 % | `formatSessionTime` | the workspace sidebar re-renders during assistant streaming |
| 2.5 % | `TurnUsage`, `formatTurnCost` | unmemoized turn footers re-run for every visible turn |
| 0.3 % | `Conversation.tsx:97` memo | the history-wide derivation chain |
| 0.2 % | `ToolCallCard` `useInView` | tool cards re-render even when unchanged |

The remainder is react-dom reconciliation plus development-only validation
(`validatePropertiesInDevelopment`, `validateProperty`, `addObjectDiffToProperties`,
`logComponentRender`).

One 75-second window of ordinary work carried 1183 SSE frames and 566 KB:

| Event | Count | Batched before C1 |
|---|---|---|
| `message_update/toolcall_delta` | 498 | no |
| `message_update/thinking_delta` | 468 | yes, one frame |
| `message_update/text_delta` | 51 | yes, one frame |
| `tool_execution_update` | 30 | no |

History-wide derivation was benchmarked directly against a real 124-message snapshot and
scaled copies of it, outside React: 0.86 ms at 124 messages, 2.72 ms at 372, and 5.18 ms at
868, of which 3.47 ms is `JSON.stringify`. This is per streamed frame, so the cost of a turn
grows with the length of the session displaying it.

Incremental argument parsing was benchmarked the same way: a 4 KB argument costs 1.0 ms
across 68 deltas, 20 KB costs 4.3 ms across 334, and 60 KB costs 46.5 ms across 1001.

### C0.1 What the evidence rules out

Do not re-investigate these without new data: Markdown and `remark-gfm` parsing (absent from
the profile; sampled assistant text parts have a median of 128 characters), syntax
highlighting (already lazy and viewport-gated), snapshot payloads (already addressed by B),
DOM and paint work, CSS animations (all gated on activity state and reduced motion), and
backend, manager, or Pi CPU.

### C0.2 Ranked causes

1. Streamed tool-call state bypasses the frame batcher, so a minority event channel produces
   a majority of the renders.
2. Streamed tool arguments are re-parsed in full on every delta, which is quadratic in the
   argument size and, for incomplete JSON, discarded.
3. Every streamed update re-renders the whole application, because the runtime's state lives
   in `App` and most of its children are unmemoized.
4. Per-render locale formatting constructs `Intl` formatters that could be shared.
5. Pure protocol helpers return fresh objects for unchanged messages, so leaf `memo` fails.
6. Background sessions trigger effects in the selected session's view.

### C1. Commit streamed tool-call state through the existing frame batcher (implemented 2026-09-11)

Owner: `src/features/conversation/useConversationRuntime.ts`.

The runtime already batches streamed assistant messages with `requestAnimationFrame`
(`queueLiveMessage` and `flushLiveUpdates`). Streamed tool-call state does not use it: each
`toolcall_delta` calls `flushLiveUpdates()` and then `setToolExecutions` directly, so 498
events became 498 unbatched renders while 519 text and thinking deltas shared at most one
render per frame.

1. Route streamed tool-execution updates through the same pending-reference and frame flush
   that already serve live messages. Commit both in one flush so their order is preserved by
   construction rather than by an explicit pre-flush.
2. Remove the `flushLiveUpdates()` calls that exist only to re-synchronize the two channels.
   Keep the deliberate flushes: blocking dialogs, optimistic user messages, selection change,
   settlement, and snapshot application.
3. Do not add a second scheduler, a timer, or a coalescing window. B1 already established
   that one scheduler is sufficient.

Proof: extend `test/conversation-runtime.test.ts` with a delta burst that asserts one commit
per frame and preserved ordering between a tool call and the message that contains it.

Implemented with one pending tool-execution ref beside the existing pending-message ref and
one shared frame callback. Tool-call deltas, execution updates, starts, ends, and interruption
all enter that queue; deliberate settlement, snapshot, dialog, and selection flushes remain.
No timer or second scheduler was added. The existing test harness does not mount React hooks,
so render frequency was proved in the shared browser rather than by pretending the pure
snapshot tests cover it: 317 `toolcall_delta` events on a larger session (99 visible messages,
139 tool cards, about 10,700 DOM nodes) blocked the main thread for 5.5 % over 57 seconds,
with a 74 ms median and 217 ms maximum long task. The C0 run blocked 42 %, with a 154 ms
median and 1400 ms maximum. Rendered messages, tool cards, activity, and console errors were
checked after the sampled tool calls. Browser-pane comparison remains separate because attaching
the shared browser to a Livecraft page and opening its own Browser tab would recursively
capture the measuring page.

### C2. Stop re-parsing streamed tool arguments on every delta

Owner: `applyToolCallUpdate` in `src/features/conversation/tool-protocol.ts`.

The `delta` branch runs `parseToolArguments` over the whole accumulated string on every
delta. Incomplete JSON fails to parse, so almost every call throws and the result is
discarded. The presentation layer does not depend on it: `toolCallPresentation` in
`src/features/conversation/tool-presentation.ts` reads incomplete arguments itself through
`streamedToolArguments` and `partialJsonObject`, and `ToolCallCard` displays
`streamingArguments` while a call is streaming or interrupted.

1. Accumulate `rawArguments` during `delta` and parse once at `end`. Keep the existing
   `end`-phase behavior and the final call identity unchanged.
2. Confirm the interrupted case still presents raw arguments, because an interrupted call
   never reaches `end`.

Proof: `test/tool-protocol.test.ts` or the nearest owning test — assert accumulated raw
arguments during streaming, final parsed arguments after `end`, and unchanged interrupted
presentation.

### C3. Return stable values for unchanged messages

Owners: `toolCallsInMessage` in `src/features/conversation/tool-protocol.ts` and
`messageMatchKey` in `src/features/conversation/message-reconciliation.ts`.

Both are pure functions over message objects that are stable for the lifetime of a snapshot,
and both allocate fresh results on every call. `toolCallsInMessage` is called in
`Conversation`'s render body for every history message, so every `ToolCallCard` receives a
new `args` identity and its `memo` can never hold. `messageMatchKey` serializes assistant
content on every frame; that serialization is the 3.47 ms measured at 868 messages.

1. Cache each result on its message with a module-level `WeakMap`. Treat the returned value
   as immutable, which the current callers already do.
2. Do not key the cache on message identifiers, counts, or timestamps. Message object
   identity is the dependency, and the deferred session-index note already records why
   identifier-plus-count keys are insufficient.
3. Make `onOpenShubAgentSession` in `src/App.tsx` a `useCallback`, matching the handlers
   beside it, so a stable `args` identity is not undone by a new callback identity.

Proof: existing `test/tool-protocol.test.ts` and reconciliation coverage must pass unchanged;
add one assertion that a repeated call for the same message returns the same reference.

### C4. Share locale formatters

Owners: `formatSessionTime` in `src/features/workspace/session-time.ts` and `TurnUsage` in
`src/features/conversation/MessageCard.tsx`.

`formatSessionTime` calls `toLocaleDateString` and `toLocaleTimeString`, which construct a
formatter per call. It runs twice per session row for every row on every application render,
and it measured 2.7 % of total CPU while the assistant was streaming. `TurnUsage` formats a
time for every visible turn on every render.

1. Hoist the formatters to module-level `Intl.DateTimeFormat` constants and format from them.
   Output must not change.
2. Wrap `TurnUsage` in `memo`. It is exported and rendered per turn, and it is the only
   conversation component in the profile that is not already memoized. Its benefit depends on
   C3 and C5 stabilizing its `usage` prop; measure after those, not before.

Proof: keep or extend the existing `session-time` coverage for same-year and older
timestamps. Locale formatting is observable behavior: assert the rendered strings.

### C5. Scope background-session effects to their workspace

Owner: the manager-event subscription in `src/App.tsx`.

`if (event.type === 'tool_execution_end') scheduleGitRefresh()` runs for every session,
including sessions in other workspaces, so unrelated background work refreshes Git and
re-renders the selected project. This contributes to the 8 % idle baseline.

1. Resolve the event's session working directory from the known session list and refresh only
   that workspace. `scheduleGitRefresh` already accepts a working directory.
2. Two sessions can share one working directory, so do not filter on session identity. When
   the working directory cannot be resolved, keep the current refresh rather than skip it.
3. `analyzeSession` in `src/App.tsx` reads `toolExecutions` and re-runs on every streamed
   update while the analysis widget is open. Confirm whether it needs streamed executions or
   only settled ones before changing it; record the answer either way.

Proof: a focused test that a `tool_execution_end` for another workspace schedules no refresh
for the selected one, and that an unresolved working directory still refreshes.

### C6. Re-baseline on the production build before judging the result

The baseline was taken against the development server. `jsxDEV`,
`validatePropertiesInDevelopment`, `validateProperty`, `addObjectDiffToProperties`, and
`logComponentRender` do not exist in a production build, and they are a material share of the
profile. Repeat C0 under `npm run start` and report both numbers. Do not attribute a
development-only cost to application code, and do not claim an improvement by comparing a
production run against the development baseline.

### C7. Decision gate before narrowing the render blast radius

`useConversationRuntime` is called in `src/App.tsx`, so each streamed commit re-renders the
whole application. Of the components `App` renders, only `Composer` and `ChatTopBar` are
memoized. `liveMessages` and `pendingSteering` reach only `Conversation`; `toolExecutions`
additionally reaches `analyzeSession`.

Moving that ownership, or memoizing large unmemoized children, is a contract change across
`src/App.tsx` and the conversation feature. Do not start it as part of C1 to C6. Run C1 to C6,
repeat C0 and C6, and start this only if streaming still exceeds the target below. If it does,
write the ownership proposal first and read [architecture](/docs/ARCHITECTURE.md); the panel
worker's loading-state contract and B1's scheduler ownership both touch the same files.

### C8. Targets and completion

Measured on the C0 case and setup, after C1 to C6 and re-baselined per C6:

- Main thread blocked while streaming: below 15 %, from 42 %.
- No long task above 300 ms, from a 1400 ms maximum.
- Renders committed per streamed turn reduced in proportion to the batched event counts, with
  identical rendered output.

Correctness must hold in the same run: streamed text, thinking, tool arguments, tool results,
interrupted calls, queue state, and turn usage all unchanged. Report metrics that did not
improve. Repeat the measurement on a long session as well as the C0 session, because the
history-wide costs scale with message count while the C0 session does not exercise them.

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

Reopened 2026-09-11: A and B measured transfer and request counts, not render frequency.
Work order C above owns the streaming render cost and carries its own baseline and targets.

## Handoff to the next two project steps

**Logging and observability:** use the useful measurements from A to define content-free,
bounded diagnostics: request counts, stage durations, errors, cache hit/miss/eviction, and
reconnects. Define retention, correlation, and overhead before permanent instrumentation.

**Stability:** extend regression coverage with longer runs, repeated switches, reconnects,
failed requests, and listener/cache cleanup. Carry forward any unexplained growth with its
reproduction steps. Fault injection that disrupts live services needs separate approval.
Stability work runs from real-life evidence: the persistent app log
([`server/features/app-log/`](/server/features/app-log/README.md), implemented 2026-09-07)
records crashes, restarts, failed requests, and client-side connection errors during
normal use; simulated heavy usage stays deferred until real logs demand it. The log file
grows without rotation by explicit decision.

## Related contracts

- [Architecture](/docs/ARCHITECTURE.md) — layer ownership and restart effects.
- [Talk to Pi](/docs/HOW-TO-TALK-TO-PI.md) — snapshot and public RPC boundary.
- [Conversation](/src/features/conversation/README.md) — reconciliation and runtime owner.
- [Workspace and sessions](/src/features/workspace/README.md) — selection and bounded lists.
