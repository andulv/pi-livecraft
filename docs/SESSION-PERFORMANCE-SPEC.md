# Session data performance: findings and plan

This is a specification and task plan. It is not a guide; no part of it is implemented yet.
It records measured findings about Livecraft's session data flow and lists the smallest
changes that remove the cost. Evidence comes from source reading (2026-09-05) and live
measurements in the shared viewer Chrome with CDP metrics and `/proc` CPU sampling.

## Symptoms

1. Livecraft feels slow after many sessions, projects, and workspaces run for a long time.
2. Switching workspaces hides the right panel. It should stay open and refresh.
3. Switching sessions or workspaces seems to repeat work.
4. Session lists and the session index (TOC) read more data than they need.

## How snapshot refresh works today

`GET /api/sessions/:id/snapshot` (`server/backend.ts`, snapshot route) sends seven Pi RPC
commands on every call: `get_state`, `get_entries`, `get_available_models`, `get_commands`,
`get_session_stats`, `get_fork_messages`, `get_available_thinking_levels`. `get_entries`
returns the full session entry list. The route then walks the parent chain
(`activeSessionMessages`), reads every prompt-template file from disk
(`loadPromptTemplates`, `server/prompt-templates.ts`), and returns everything as one JSON
response.

The frontend calls this route from `useConversationRuntime`:

- on every `tool_execution_end`, debounced by 100 ms;
- on every `message_end`;
- on every `agent_settled`.

So one busy turn triggers several full-history round trips. Each response replaces
`snapshot.messages` with a new array. The session index recomputes over all messages, and
the conversation re-renders from the new identity.

## Findings

| # | Finding | Owner | Cost |
|---|---|---|---|
| F1 | Every snapshot re-fetches static data: models, commands, fork messages, thinking levels, prompt templates | `server/backend.ts` snapshot route | 6 of 7 RPC commands plus disk reads repeat for data that rarely changes |
| F2 | `get_entries` ships the whole history each time; sessions grow without bound | Pi RPC via `server/manager.ts` | Many MB per call for long sessions; repeated several times per minute while Pi works |
| F3 | The panel resets on workspace switch: `handleWorkspaceSelected` sets the active widget to null | `src/App.tsx` `handleWorkspaceSelected` | User-visible annoyance; widget choice persists in `pi-livecraft.right-sidebar-widget` but is cleared at runtime |
| F4 | The analysis panel hides while its data loads (`rightPanelVisible` requires `sessionAnalysis`) | `src/App.tsx` layout | Panel blinks off during loads instead of showing a loading state |
| F5 | A workspace switch runs: manager list + bounded session scan + possible Pi reopen + full snapshot + Git snapshot + VS Code colour + environment | `useWorkspaceSessions.selectWorkspace`, `App` effects | Most steps are needed once; the snapshot's static parts (F1) are not |
| F6 | `refreshSessions` re-runs on every `session_created`, `session_reassigned`, and `manager_connected` SSE event, for any project | `App` manager-event subscription | With many live sessions, unrelated events re-scan this project's list |
| F7 | The session index recomputes over all messages on every snapshot | `src/features/session-index/session-index.ts` | Repeated full-array work during active runs |
| F8 | The session list is already efficient: head 8 KB + tail 16 KB per file, at most 30 files; pins resolve by path | `server/pi-session-store.ts` | No change needed |
| F9 | Snapshot refreshes continue while the tab is hidden | `useConversationRuntime` | Wasted work in background tabs |

Measured context (idle UI, 30 s, software-rendered viewer Chrome): the old infinite CSS
status animations caused 1,784 style recalculations and ~56 % GPU + 22 % renderer CPU.
After the discrete size pulse (`SessionStatusIndicator`), recalculations dropped to 60 and
the GPU sat near idle. Backend and manager CPU stayed under 5 % when idle. The remaining
hot path is snapshot fetch and render during active runs.

## Plan

Ordered by size. Each task is independent; do them in order and stop when the symptoms are
gone. Keep the HTTP and SSE contracts observable: new fields are additive.

### T1 — Keep the right panel open on workspace switch

Remove `setActiveRightWidget(null)` from `handleWorkspaceSelected` in `src/App.tsx`.
Widget data already flows from App props and refreshes with the newly selected session.
Clearing open file paths can stay.

Add a loading state instead of hiding: when `activeRightWidget === 'analysis'` and
`analysisAvailable` is false, render the panel with a "Loading analysis…" body. Adjust
`rightPanelVisible` so the chosen widget stays visible while its data loads.

Validation: manual — switch workspaces with the index and analysis panels open; panel
stays, data follows the new session. `npm run typecheck`.

### T2 — Background-aware snapshot refresh

- Add a `snapshotLoading` flag to `useConversationRuntime`; expose it through `App`.
- Session index and analysis widgets show the flag instead of blanking.
- Skip debounced snapshot refreshes while `document.hidden`; fetch once when visible again.

Validation: focused test for the flag transitions beside the existing conversation tests;
manual check of the loading indicator on a slow snapshot.

### T3 — Cache static snapshot parts per session

Move the rarely changing parts of the snapshot route behind a per-session cache:
`get_state` (model/state only refresh on events), `get_available_models`, `get_commands`,
`get_fork_messages`, `get_available_thinking_levels`, and prompt templates. Refresh
`get_entries` and `get_session_stats` on every call. Invalidate the cache when the session
exits or when a `session_info_changed` event names the session. Keep the response shape
unchanged.

Validation: extend the backend snapshot tests with cache-hit coverage; measure payload
latency before and after on a long session.

### T4 — Incremental messages

Messages are append-only per active chain. Add an optional `since` query parameter
(last entry id the client holds). The backend compares it with the cached entry list and
returns only appended messages plus current stats; the client merges in
`useConversationRuntime`. A full snapshot remains the fallback when the id is unknown.
This changes `shared/types.ts` additively and the snapshot route; document the parameter
beside the route.

Validation: backend tests for append, unknown id, and compaction (id no longer on the
active chain falls back to full snapshot); manual session run with the network panel open.

### T5 — Scope manager-event refreshes

In the App manager-event subscription, run `refreshSessions` for `session_created` and
`session_reassigned` only when the event's `cwd` belongs to this project's workspaces.
`manager_connected` stays global.

Validation: focused test beside the existing App/workspace tests; manual run of two
projects side by side.

### T6 — Cheap session-index guard (optional)

After T4, message identity changes only on appends. If profiling still shows index cost,
memoize `sessionIndexEntries` on last message id plus count. Do this only with evidence.

## Risks and boundaries

- Pi, the manager, and the RPC protocol are unchanged. All work sits in the backend route,
  shared types (additive), and frontend hooks.
- The manager lifecycle is untouched; no restart behaviour changes.
- The session list keeps its bounded scan (F8); do not widen it.
- T4 is the only contract change; it is additive and keeps the full-snapshot fallback.

## Related documents

- [Project architecture](/docs/ARCHITECTURE.md) — layer boundaries used above.
- [Conversation feature](/src/features/conversation/README.md) — snapshot runtime owner.
- [Workspace and sessions](/src/features/workspace/README.md) — switch flow owner.
- [Right sidebar](/src/features/right-sidebar/README.md) — widget persistence keys.
