# Workspace watching and freshness

Status: **proposal** — no watcher implementation is authorized by this document.

## Goal and boundary

Keep Git status, loaded Files listings, and open read-only file previews current when agents, shells, editors, or Git modify the selected worktree. Preserve fast first load and responsive switching in a worktree with at least 18,613 untracked files. Events are hints to fetch authoritative state, not an event log, file contents, or a replacement for manual refresh.

Adopt Theia's **backend-owned, shared subscription pattern**, not necessarily its watcher library or process topology. `server/backend.ts` owns the HTTP/SSE boundary; a small backend files capability owns watcher lifecycle; `src/api.ts` owns browser transport; `src/App.tsx` coordinates Git and files invalidation. Do not move this into the Pi manager, change manager restart semantics, or watch every known project by default.

This supersedes the watcher/freshness implementation details in [workspace-viewer-state-and-file-freshness.md](./workspace-viewer-state-and-file-freshness.md), steps 6–9. Its already implemented viewer-state work and unrelated terminal plan remain separate. In particular, this plan **does not assume** a recursive watch is cheap or reliable enough before measurement, and includes Git status and linked-worktree metadata in scope.

## Existing behavior and freshness contract

| Surface | Baseline | Intended behavior |
|---|---|---|
| Selected Git snapshot and Changes | `App.tsx` fetches all discovered worktrees at first load and again on selection; tool completion triggers a debounced refresh; actions/manual Refresh refresh selected. | Fetch selected worktree immediately on every selection, even if a snapshot exists. Preserve old data visibly while a fetch runs; retain manual Refresh and action/tool triggers. External edits invalidate it when watching is healthy. |
| Other worktree cards | Currently requested as part of that all-worktree set. | Continue refreshing discovered worktrees, but with selected-first priority and bounded global concurrency. Do not represent an older card snapshot as freshly checked; selecting its worktree starts a new fetch. Do not automatically watch all inactive worktrees. |
| Files explorer | Root loads on mount, descendants on expansion; loaded listings can become stale. | On a targeted hint, refresh loaded affected parent directories. On an ambiguous hint or recovery, refresh the root and loaded visible directories; mark other loaded directories stale and recheck before expansion. Keep old rows, filter, selection, and expansion during refresh. Manual retry/refresh remains available. |
| Open viewer files | Reads once on activation and caches by path until workspace change. | Re-read an affected active file; mark affected inactive open files stale and re-read on activation. Unknown-path recovery checks the active file and marks inactive files stale. Preserve last successful content during checks; clearly distinguish missing from transient read failure. No file editing or dirty-buffer policy is introduced. |
| Git diffs | Working-tree diffs and immutable commit diffs are fetched on demand. | Mark open working-tree diff tabs stale after relevant changes, reload when active or activated; never rewrite an immutable commit diff because of filesystem events. |
| Sessions, discovery, settings | Have independent lifecycle/manual refreshes. | No filesystem-watch subscriptions for these surfaces in this proposal. |

Git status remains authoritative from Git, listings from the existing workspace-files API, and content from the existing file-read/diff APIs. Refresh failures preserve last-known values with an honest stale/error state; they do not silently certify freshness.

## Phase 0: bound Git work before adding an event source

1. Replace the all-at-once `refreshGit(path)` loop in `App.tsx` with selected-worktree-first scheduling and a small, measured global in-flight limit (trial: two). Coalesce duplicate requests per canonical worktree, including switch and tool events. Ensure a selection during an older request schedules or performs a fresh check rather than accepting an older response as current.
2. Give each worktree at most one active snapshot and one pending rerun. Debounce tool/watch bursts (trial: 250 ms), enforce a maximum wait during continuous activity, and prevent an unbounded retry or subprocess queue. A manual request must not wait behind every background worktree; errors must release scheduler capacity.
3. Preserve current on-selection, action, tool-completion, and manual refresh triggers. Background worktrees eventually receive their scheduled checks; record/check the freshness of their displayed data. Do not cache-only the selected worktree, truncate Git results, or change the Git snapshot response shape to make a watcher look faster.
4. Measure page-load responsiveness and Git process count on the large worktree before and after this phase. Do not proceed to watcher work if first load is still unusable.

## Phase 1: subscription and event contract

**Ownership.** Add a small service under `server/features/files/` (or the narrowest existing file capability). Resolve and validate the requested workspace in `server/backend.ts` through the existing working-directory boundary. Key subscriptions by canonical worktree root; one backend watcher serves all browser clients viewing that root. Start on first subscriber, close on last subscriber (optionally after a short idle grace period), and close on backend shutdown. Do not include watcher files in `server/manager-runtime-files.json`.

Use a **dedicated same-origin workspace SSE route**, for example `GET /api/files/watch?cwd=…`, instead of injecting workspace events into the global manager-event stream: the latter broadcasts to all tabs and its `ManagerEvent` contract does not identify an authorized worktree. `src/api.ts` alone constructs the URL, validates messages, handles native reconnect and a permanently CLOSED `EventSource`, and disposes on workspace change/unmount. A tab switch must not leak a subscription to its previous root.

A bounded shared wire type might be:

```ts
type WorkspaceInvalidation = {
  kind: 'workspace_invalidated'
  paths: string[] | null // workspace-relative hints; null means full rescan
  git: boolean
}
```

Its precise shape is settled during implementation in `shared/types.ts`. Only normalized, bounded relative paths may cross the wire; no absolute project path, file contents, prompts, or session ID. A missing filename, unsafe path, overflow, ambiguous metadata event, or watcher error collapses to a full-rescan hint. Coalesce bursts (trial: 100–250 ms); cap path count (trial: 256), frame size, and pending batches. Never log individual paths or filesystem events. Under sustained writes, do not reset the debounce indefinitely; bound refresh frequency and memory. If an SSE client cannot drain, drop/coalesce to a rescan or close it so reconnection recovers rather than buffering without bound.

On **every** new SSE attachment or reattachment, send a full-rescan hint after the subscription is established; native SSE retries have no guaranteed filesystem-event replay. On visibility return and detected transport recovery, the frontend also rechecks the selected workspace even if it missed a hint. A failed watch reports unavailability and falls back to selection, focus/visibility, tool, action, and manual refresh. Do not silently treat a failed watcher as healthy; avoid tight restart loops.

## Phase 2: watch scope and feasibility gate

Start with **only the selected canonical worktree root per active browser tab**, sharing that root across tabs. A worktree switch unsubscribes the old root and subscribes the new one. Linked worktrees have separate roots; their Git administrative paths may be elsewhere. Resolve Git's per-worktree git-dir and common-dir using Git in the already validated worktree, and decide whether narrowly watching their metadata is required to catch ref/index changes with no working-tree event. Do not assume `.git` is a directory or recursively watch an entire common Git object store. Metadata hints invalidate Git only; working-tree hints invalidate Git and affected Files/viewer data. Git actions still refresh explicitly.

Before selecting an engine, prototype on the large worktree using Node 24's recursive `fs.watch`; measure **directory count**, watcher descriptors, memory, CPU, event rate, time to readiness, and backend responsiveness. Compare one and two tabs (one shared watch), nested and atomic edits, bulk writes/checkouts, index-only changes, linked-worktree operations, symlinks, deleted roots, missing filenames, and forced watcher failure. Determine whether native watching covers the target environment reliably and whether any exclude can be introduced without making visible Files data stale. `node_modules`, `.git`, and generated trees are *not* blanket exclusions until their impact on both Git and the explorer is specified. Trial `@parcel/watcher` only if native behavior demonstrably fails the cost/reliability gate; adding that dependency requires separate approval. Never use a per-file watch or a root watch in the manager.

**Gate:** if starting or maintaining the watch materially slows first load, exhausts resources, or floods status checks under a bulk operation, do not ship it; retain Phase 0 plus selection/focus/tool/manual reconciliation. A watcher must not block HTTP readiness or the initial Git request. Record the measured baseline and trial results in `plans/investigations/` before choosing the engine, exclusions, and tuning constants.

## Phase 3: apply hints without refresh storms

- `src/App.tsx` maps the subscribed canonical root to its Git scheduler and passes file invalidations to the Files feature. A late event from a previous selection cannot update the selected workspace. A new generation/request token prevents older responses from overwriting newer snapshots or file contents.
- `FileExplorer.tsx` uses its loaded-directory map to choose parents for changed relative paths. Create/delete/rename may affect a parent even if the changed filename is no longer readable. A directory event may require invalidating loaded descendants. A full rescan is bounded by loaded/visible directories and lazily checks the rest; it does not enumerate the whole repository on each event.
- `FileContentPane.tsx` re-reads only active affected files; other open paths become stale. Treat ambiguous events conservatively. Working-tree diffs are similarly invalidated; commit-hash diffs remain unchanged. Do not infer a rename or close a tab on a failed read.
- Recovery after backend restart, SSE reconnect, hidden-tab return, or watcher overflow revalidates selected Git, root/loaded-visible listings, active file, and active working-tree diff. Other worktrees remain on the bounded Git schedule and are always checked when selected.

## Tests, evidence, and rollout

- Focused tests: Git scheduling (priority, duplicate events, max concurrency, switch races, failure/retry); watcher service (canonical root sharing, two-tab teardown, bounded bursts/overflow, missing/unsafe paths, backpressure, error and reconnect rescan, linked worktree metadata); frontend API subscription and Files/viewer stale-response handling. Likely neighbors: `test/git.test.ts`, `test/api-events.test.ts`, `test/workspace-file.test.ts`, `test/file-tree-data.test.ts`; add focused tests for new logic rather than expanding unrelated suites.
- End-to-end trial in the existing shared browser: compare first load before/after; edit, atomic-save, create, delete, rename, and bulk-change in a large worktree; switch worktrees/tabs; stop/restart **only the backend in a controlled test** and verify recovery without restarting Pi; test failed watching and manual refresh. Do not restart a running stack merely to investigate or implement the plan.
- Validate with focused tests, Oxlint, typecheck, and the project formatter. Check backend request/CPU/memory and Git subprocess counts rather than measuring only rendered rows. Never emit paths or content to persistent diagnostics.
- Rollout sequence: ship Phase 0 independently; collect Phase 2 measurements; choose an engine and refine the wire contract; implement Phases 1 and 3 behind a narrow selected-worktree scope; retain fallback if the cost/reliability gate fails. Update affected feature READMEs and architecture documentation when implementation actually changes their contracts.

## Sources and constraints

- [Theia frontend file-service watcher reuse](https://github.com/eclipse-theia/theia/blob/master/packages/filesystem/src/browser/file-service.ts), [watcher protocol](https://github.com/eclipse-theia/theia/blob/master/packages/filesystem/src/common/filesystem-watcher-protocol.ts), [backend wiring](https://github.com/eclipse-theia/theia/blob/master/packages/filesystem/src/node/filesystem-backend-module.ts): inspiration for shared backend subscriptions, not proof that its exact backend implementation applies here.
- [VS Code watcher internals](https://github.com/microsoft/vscode/wiki/File-Watcher-Internals) and [Git extension status handling](https://github.com/microsoft/vscode/blob/main/extensions/git/src/repository.ts): watching and Git process scheduling are separate concerns.
- [GitHub Desktop selection/focus refresh](https://github.com/desktop/desktop/blob/development/app/src/lib/stores/app-store.ts): a viable event-driven fallback, not proof that all external changes are instantly visible.
- [Node `fs.watch` caveats](https://nodejs.org/api/fs.html#fswatchfilename-options-listener) and [Parcel Watcher](https://github.com/parcel-bundler/watcher): event delivery and cost must be tested on the target filesystem.
