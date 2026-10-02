# Data flow and expensive operations

Pi Livecraft gets slower when features each fetch what they need on their own: one UI event can then start dozens of Git processes or session-file scans, and every open tab repeats the work. This guide is the shared contract for **how data is retrieved and when**. Read it before adding a fetch, a process spawn, a file scan, a Pi RPC path, or a new trigger for an existing one.

Measurements come from the [operation ledger](/server/features/diagnostics/README.md#operation-ledger): the Diagnostics widget shows live totals per operation and per `route ← cause` trigger, and `pi-livecraft-app.log` keeps slow operations, bursts, and request fan-outs.

## Rules

1. **The server owns expensive data.** Each resource below has one owning module. Components ask for the resource through `src/api.ts`; they do not combine cheaper calls or re-derive it.
2. **Measure at the chokepoint.** Every process spawn, file scan, and RPC goes through `measureOperation` once, at the narrowest owning function.
3. **Name every trigger.** A frontend call that can cause expensive work passes its own `RequestCause` (`<area>:<trigger>`). Reusing another trigger's name hides the new cost.
4. **Share instead of repeating.** Identical concurrent reads share one in-flight execution on the server, across tabs, and repeated reads reuse a cached result until a named invalidation. Every open tab is a separate client: N tabs must not cost N times the work.
5. **Coalesce event-driven refreshes.** A burst of events produces one refresh, and only events that can change the resource trigger it.
6. **Pay for what changed.** Re-reads use cheap change detection (`stat`, revisions, cursors) and only reprocess changed items.
7. **Declare a budget.** Each trigger below has an expected operation count. Non-trivial resources keep a focused test that asserts it.

## Resource catalog

Costs are per request. "Cache" means server-side unless stated otherwise.

| Resource | Owner | Cost | Cache and sharing | Invalidated by |
|---|---|---|---|---|
| Git snapshot (`GET /api/git`) | `getGitSnapshot`, `server/features/git/git.ts` | 6 `git` processes (8 in a linked worktree) | Shared runs per directory (`FreshRuns`): callers within 25 ms share one run, mid-run callers share the next one, never an older result; per tab, a stale-response guard and a 250 ms debounce for tool-end refreshes | — (each run reads current state) |
| Git project (`GET /api/git/project`) | `getGitProject` | 3 `git` + 1 `stat` per worktree | None | — |
| Git diffs, outgoing changes, commit files | `getGitFileDiff`, `getGitOutgoing*`, `getGitCommitFiles` | shared Git snapshot (diffs, outgoing) + 2–5 `git` | The snapshot part is shared | — |
| Git mutations (commit, push, pull, reset, revert, discard) | `git.ts` | shared Git snapshot for validation + the mutation | — | — |
| Live session list (`GET /api/sessions`) | manager `list` | 1 manager RPC + 1 `get_state` per live Pi session | None | — |
| Recent sessions (`GET /api/sessions/recent`) | `listRecentPiSessions`, `server/pi-session-store.ts` | `readdir` + `stat` of every session file in the workspace folder; only new or changed files get head and tail reads (tail scan up to 4 MB), and changed sub-agent children a full read for usage | Parsed metadata per file, keyed by path, size, and mtime (5,000 files); concurrent scans of one folder share one execution | A file's size or mtime changes |
| Pinned sessions (`POST /api/sessions/resolve`) | `resolvePiSessions` | path checks + 1 `stat` per pin; content reads only for changed files | The same per-file metadata cache | A file's size or mtime changes |
| Session snapshot (`GET /api/sessions/:id/snapshot`) | `backend.ts`, `server/snapshot-requests.ts` | `get_state`, `get_entries`, `get_session_stats` always; models, commands, fork messages, thinking levels, and prompt templates when not cached | `MetadataCache`: 60 s TTL, 20 sessions LRU, in-flight sharing; per tab, one in-flight load per session plus delta reads with a `since` cursor | Session exit or reassignment, manager connect or disconnect, prompt-template save |
| Quotas (`GET /api/quotas`, `POST /api/quotas/refresh`) | `server/features/quotas/` | `GET`: manager `list`; refresh: a `/livecraft-quotas` prompt command in Pi | Last valid report per provider; one refresh in flight | New report events from Pi |
| Session environment (`GET /api/environment`, refresh) | `server/features/session-environment/` | `GET`: manager `list`; refresh: a `/livecraft-environment` prompt command | One report per session; one refresh in flight per session | New report events from Pi |
| Workspace files and directories | `server/workspace-file.ts`, `listDirectories` in `backend.ts` | one `readdir`, or one `readFile` of at most 2 MiB | None | — |
| Pi processes | `server/manager.ts`, `server/pi-process.ts` | one `pi --mode rpc` per new session beyond the pool, per temporary rename, and per isolated prompt | Process pool rules in the [manager lifecycle](/docs/MANAGER-LIFECYCLE.md#pi-process-allocation) | — |

## Triggers

What runs when something happens. "Per tab" work is repeated by every open Livecraft view.

| When | Cause | What runs |
|---|---|---|
| A Pi tool call finishes (`tool_execution_end`) | `git:tool-end`, `snapshot:tool-end` | Per tab, after 250 ms, unless the tool is read-only (`read`, `grep`, `find`, `ls`): one Git snapshot request for the session's workspace; concurrent tabs share one run. Also a delta snapshot after 100 ms. |
| `message_end`, `queue_update`, `agent_settled` | `snapshot:settled`, `snapshot:queue-update` | Per tab: a delta snapshot for the selected session. `agent_settled` also refreshes quotas (`quotas:agent-settled`), at most once per 30 s per session and provider. |
| A session is created or reassigned, or the manager (re)connects | `sessions:session_created`, `sessions:session_reassigned`, `sessions:manager_connected` | Per tab, once per 250 ms window of such events (cause of the first event): live session list + recent-sessions scan. After a manager restart, every reopened session emits `session_created`. |
| The manager connects | — | Backend: clears `MetadataCache`; refreshes quotas and environment through one idle session. |
| Project view opens, the worktree list changes, or the workspace switches | `git:workspace-paths`, `sessions:workspace-switch` | Per tab: one Git snapshot request per worktree of the project (shared across tabs); one recent-sessions scan. |
| The project registry loads or the project changes | `projects:discovery`, `projects:activity` | Per tab: one Git project per registered project, then one recent-sessions scan per worktree of every project. |
| Session selected | `snapshot:selection`, `environment:selection` | Per tab: a full snapshot and the environment report. |
| Tab becomes visible after missed events, or SSE reconnects | `snapshot:visible`, `snapshot:reconnect` | Per tab: a delta snapshot reconciliation. |
| Session starts, is renamed, moved to another worktree, closed, or a dialog closes | `sessions:session-started`, `sessions:rename`, `sessions:move`, `sessions:close`, `sessions:dialog-*` | Live session list + recent-sessions scan. A move scans both the source and destination worktree. |
| Git widget action or manual refresh | `git:after-*`, `git:manual` | The action, then one Git snapshot. |
| Pinned sessions load or manual refresh | `pins:mount`, `pins:manual` | One session-file read per pin. |
| A dialog response, composer command, or `/agent` activation completes | `snapshot:dialog-response`, `snapshot:composer-command`, `snapshot:agent-activated` | One snapshot for the affected session. |
| Quota or environment reports arrive from Pi, or the widgets load or act | `quotas:mount`, `quotas:manual`, `quotas:status-report`, `quotas:after-reset`, `environment:manual`, `environment:status-report` | Cached reports; a refresh sends one prompt command to an idle session. |
| Diagnostics or browser-debug widget open | — | Polls every 5 s (diagnostics; also reads the manager ledger) or every 2 s while visible (browser debug). |

## Long-lived connections

Connections are a shared resource too. The app is served over HTTP/1.1, by the Vite proxy
in development and by the backend in production, and Chrome allows **six concurrent
connections per origin, shared by every tab of one browser profile**. Each stream below
holds one connection for as long as it is open; ordinary requests (snapshots, Git, input,
client logs) share whatever remains and queue when none is free.

| Stream | Route | Held by |
|---|---|---|
| Manager events | `GET /api/events` | every open tab, always |
| Browser frames and input | one WebSocket per viewer (`.../socket`; outside the HTTP pool) | every visible tab showing the Browser pane; hidden tabs close it |
| Terminal output | `GET /api/terminal/instances/:id/stream` | every tab showing an embedded terminal |

Three tabs that each show the Browser pane hold all six connections, and every other
request from any of them waits indefinitely — a view stuck loading its snapshot is the
expected symptom. A new long-lived stream therefore needs a strong reason; prefer carrying
its events on an existing stream. The [stability monitor](/server/features/diagnostics/README.md#stability-monitor)
reports open streams by kind, and client drop and stall reports include each tab's own load.

## Measured hotspots

Measured on 2026-10-01 with four tabs open and an agent working.

- **Recent-sessions scans** averaged 1.1 s, peaked at 11 s, and ran up to six at once; 40 scans followed one manager restart within 36 s. The workspace folder held 174 session files (138 MB), about 112 of them sub-agent children. Main triggers: `projects:activity` and repeated `session_created` events. With the per-file metadata cache, an unchanged rescan of that folder takes about 3 ms; only the first scan after a backend start pays the full cost.
- **Git tool-end refreshes** produced bursts of at least 40 `git` processes in 10 s throughout agent work, about 13 per refresh and tab, including after read-only tools.
- **Full session snapshots** of a long session reached 6 MB and 1.9 s, dominated by `get_entries`.

## Budgets

Targets that new work must not exceed. A budget marked *not yet* is a known gap.

| Trigger | Budget | Status |
|---|---|---|
| Any number of tabs reading the same resource at the same time | one execution on the server | Met for recent sessions and Git snapshots (`test/git.test.ts`) |
| Recent sessions, nothing changed on disk | `readdir` + one `stat` per file; no file content reads | Met (`test/pi-session-store.test.ts`) |
| A burst of `session_created` events | one session-list refresh per tab | Met: one per 250 ms window (`test/session-refresh-batch.test.ts`) |
| `git:tool-end` during agent work | at most one Git snapshot per worktree per refresh interval, shared by all tabs; none after read-only tools | Met: 6 processes per refresh for any number of tabs (13 per tab before) |

## Adding a data source or trigger

1. Find the resource in the catalog. If it exists, use its owner and add only a named cause.
2. For a new resource, put the owner on the server, measure it with `measureOperation`, and add a catalog row with its cost, cache, and invalidation.
3. Add the trigger row: which event, how often, per tab or shared.
4. Verify in the Diagnostics widget that the new trigger costs what the row says; add a focused budget test for non-trivial resources.
