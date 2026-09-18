# Workspace viewer state and file freshness specification

Status: **in progress** — steps 1–3 implemented, steps 4–10 remain.

## Goal

Make the viewer pane behave as part of a workspace rather than as one global set of
transient tabs, and keep the file explorer and open-file previews current while agents,
embedded terminals, external editors, builds, and Git operations modify the workspace.

Each workspace should recover its own open files, selected file/browser/terminal tab,
and browser/embedded-terminal openness when the user switches away and back. Open file
content and lazy directory listings should refresh automatically without discarding tab,
expansion, scroll, or selection state.

The only terminal in this model is Livecraft's **embedded xterm terminal tab**. The old
facility that launches a separate local terminal application is obsolete. Its UI,
setting, API, backend launcher, and tests are removed; existing `Open terminal` entry
points are retargeted to open and activate the embedded terminal tab.

## Relationship to the viewer proposal

This proposal composes with
[`code-and-media-viewers.md`](./code-and-media-viewers.md):

- that proposal owns CodeMirror and file-type-specific rendering;
- this proposal owns when a file is stale, reloaded, missing, or restored as an open
  tab;
- CodeMirror scroll/selection state may remain in its feature-local runtime cache, but
  its file tab and active view belong to the workspace viewer state defined here;
- media object URLs and file contents are runtime data and are never persisted.

Neither proposal introduces file editing or saving.

## Decisions

- Store viewer state by the **exact canonical workspace path**. Worktrees do not share
  tabs merely because they belong to the same repository.
- Model all workspace viewer states as one keyed map instead of saving/resetting a flat
  state during the workspace-switch callback.
- Persist only bounded, serializable UI state in a versioned localStorage document.
- Keep file contents, directory entries, terminal output, browser frames, loading
  state, and errors out of localStorage.
- Keep the pane-width preference global. It is a layout preference, not workspace
  content.
- Use three complementary freshness triggers: explicit refresh, Pi tool-event
  invalidation, and a backend filesystem-watch SSE stream.
- Treat every watcher event as an invalidation hint. The source of truth remains a
  fresh directory listing or file read.
- Preserve tree expansion and visible file content while refreshing.
- Do not infer a rename from ambiguous filesystem events. A missing old path and a new
  tree entry are preferable to retargeting the wrong tab.
- Retain the existing `open-terminal` command ID and shortcut so user shortcuts keep
  working, but change the action to the embedded terminal tab.

## Non-goals

- Persisting or restoring shell processes in the browser. Embedded terminal process
  lifetime remains backend-owned.
- Making embedded terminals survive a backend restart. The existing tmux-backed path
  remains future work.
- Persisting browser frames or browser process state in localStorage.
- Editing files, dirty tabs, unsaved buffers, merge conflicts, or save APIs.
- A complete filesystem event log or guaranteed event ordering.
- Automatic rename correlation based on timing, size, inode, or content guesses.
- Watching every registered project or workspace when it is not selected by a browser
  client.
- Introducing a database, frontend state library, or filesystem-watch dependency.
- Changing manager supervision or adding file watching to the Pi manager.

## User experience

### Workspace switching

If workspace A has these tabs:

```text
README.md | src/App.tsx | Browser | Terminal
```

and workspace B has:

```text
docs/spec.md | Terminal
```

switching A → B → A restores each workspace's own ordered tabs and previously active
view. The state restoration does not copy tabs from one workspace to another.

Restoring a workspace:

1. renders its saved tab strip immediately;
2. mounts only its active viewer;
3. re-reads an active file rather than trusting persisted content;
4. reattaches Browser to `{ workspacePath, browserId }` when its tab is open;
5. reattaches Terminal to `{ workspacePath, terminalId }` when its tab is open;
6. performs a file freshness rescan after reconnecting the watcher.

Switching away unmounts the current `BrowserView` and `TerminalView` subscriptions but
does not stop their backend processes. In particular, unmounting an embedded terminal
must continue to unsubscribe only; it must not call the terminal stop endpoint.

After a full frontend reload, the same serializable viewer state is restored. Backend
browser and terminal sessions are reattached when they survived. If the backend
restarted and an embedded shell no longer exists, the restored Terminal tab follows
its existing start/unavailable/restart lifecycle; localStorage must not imply that the
old shell survived.

### File explorer refresh

The explorer gains a compact refresh button beside its filter. Refreshing:

- re-lists the root and every directory whose children were loaded;
- keeps the filter and expanded-path set unchanged;
- leaves current rows visible while requests are in flight;
- shows a quiet refreshing indicator rather than replacing the tree with an initial
  loading state;
- ignores stale responses from an earlier refresh generation.

New files appear, deleted files disappear, and changed directory structures update
without forcing the user to collapse and reopen a folder.

### Open-file refresh

The active file header gains a compact refresh action. The same refresh can happen
automatically from a watcher or agent event. While checking, the last successful
content remains visible with a quiet `Checking…` status.

After the response:

- unchanged revision: remove the checking state without rerendering the viewer;
- changed revision: replace the content, preserve viewer position where the viewer
  supports it, and briefly show `Updated`;
- missing path: show `Deleted on disk`; when previous content exists, it may remain
  visible only with an explicit `Showing the last loaded version` warning;
- other read failure: retain the previous successful content and show
  `Couldn’t refresh` with a retry action.

Inactive open files are marked stale and revalidated when activated. They need not all
be read eagerly after every event. A restored inactive tab is only a path until the
user activates it.

### Rename behavior

A watcher commonly reports creation, deletion, and rename as the same low-level event.
Therefore:

- an open old path becomes `Deleted on disk` after confirmation;
- the new path appears in its parent directory after refresh;
- the old tab is not silently renamed;
- a future operation with an authoritative old/new pair may retarget a tab, but that is
  outside this version.

### Freshness availability

If filesystem watching is unavailable or fails, the application remains usable:

- manual refresh stays available;
- Pi tool events still invalidate the relevant workspace;
- returning browser focus revalidates the selected workspace;
- the explorer may show a non-blocking `Live refresh unavailable` tooltip/status;
- existing file/tree data is not discarded.

## Visual contract

The files feature remains the owning visual surface. Add no new card or global status
panel.

### Explorer header

The filter and refresh action form one compact row:

- the filter takes remaining width;
- refresh is an icon button with an accessible name;
- the button uses the established compact-control height and files-feature focus
  treatment;
- a spinning or changing icon is optional, but any animation must stop under
  `prefers-reduced-motion`;
- loading does not change row height or cause the tree to jump.

### File header

Keep the existing three-part alignment:

1. truncated path;
2. file-specific mode controls;
3. freshness/status and refresh action.

`Checking…`, `Updated`, `Deleted on disk`, and error text must not push controls outside
the pane. Use text plus state styling; do not rely on colour alone. Long paths retain a
native title/tooltip. Error and deleted states remain usable at the pane's 280 px
minimum width and in both themes.

The existing pane remains hidden below 900 px. This proposal does not add a separate
mobile viewer.

## Workspace viewer-state model

Add a pure module under `src/features/workspace/`, for example
`workspace-viewer-state.ts`:

```ts
export type WorkspacePaneView =
  | { kind: 'file'; path: string }
  | { kind: 'browser'; browserId: string }
  | { kind: 'terminal'; terminalId: string }

export interface WorkspaceViewerState {
  openFilePaths: string[]
  activeView: WorkspacePaneView | null
  browserOpen: boolean
  terminalOpen: boolean
  touchedAt: number
}

export interface PersistedWorkspaceViewerStates {
  version: 1
  workspaces: Record<string, WorkspaceViewerState>
}
```

The implementation uses `PaneView` (not `WorkspacePaneView`) as the union type name,
and the persisted document shape is module-private. The hook lives in
`useWorkspaceViewerState.ts` rather than inline in `App.tsx`.

These invariants are required and enforced:

- `openFilePaths` are ordered, unique, non-empty relative paths;
- an active file must be present in `openFilePaths`;
- an active browser requires `browserOpen` and the supported browser ID;
- an active terminal requires `terminalOpen` and the supported terminal ID;
- malformed or invalid active views are repaired through the normal fallback order;
- unknown object keys and unsupported versions fail safely instead of preventing app
  startup.

### State ownership

`App.tsx` continues to orchestrate this cross-feature state, but it owns one map:

```ts
Record<CanonicalWorkspacePath, WorkspaceViewerState>
```

All open, close, activate, and reorder actions update the entry for the explicit
workspace path. Workspace switching only selects another entry; it does not first save
and then clear flat state. This avoids races between the previous and next
`workspacePath`.

`FileContentPane` receives the selected workspace's derived state and callbacks as it
does today. Its `key={workspacePath}` remount remains useful for disposing runtime file
and viewer resources.

### Fallback selection

When closing or repairing the active view, choose deterministically:

1. the nearest remaining file tab according to the existing close behavior;
2. Browser if its tab is open;
3. Terminal if its tab is open;
4. otherwise `null`.

Switching workspaces does not run this fallback unless the restored state is invalid.

### Persistence

Use one versioned key:

```text
pi-livecraft.workspace-viewer-state
```

The reader and writer live with the pure state module and follow existing defensive
localStorage readers. Bound persisted state to prevent unbounded growth:

- at most 24 workspace records, evicting least-recently-touched records;
- at most 50 open file paths per workspace;
- discard malformed, empty, absolute, or traversal-like file paths;
- accept only the supported `main` browser and terminal IDs in version 1.

Persistence happens as workspace viewer state changes. This is remembered UI state,
not a setting edited in the Settings dialog. Register the key in the Livecraft reset
registry so **Reset Pi Livecraft preferences** can remove it.

Do not move the existing browser URL into this store in the first implementation.
`browser-url.ts` already persists URL by workspace and browser ID. Keeping that working
contract avoids an unrelated migration. `filePaneShare` also remains global.

## Embedded terminal and browser semantics

### Embedded terminal

The embedded terminal service already identifies sessions by canonical workspace path
and terminal ID. Restoring the tab therefore restores UI attachment, not shell state:

```text
{ workspacePath, terminalId: "main" }
```

`TerminalView` keeps its subscribe-before-start behavior. Reopening or restoring a live
session replays from the backend buffer without duplicating output. Closing the tab or
switching workspaces only unmounts the viewer subscription; the shell continues until
its existing backend lifecycle stops it.

### Browser

Browser uses the equivalent identity:

```text
{ workspacePath, browserId: primaryBrowserId }
```

Restoring an open Browser tab mounts `BrowserView`, which reattaches to or starts the
workspace's backend-owned browser as today. Its URL remains managed by the existing
workspace/browser-scoped storage helper and live URL events.

## File revision contract

Extend text reads with a revision derived from the validated file stat:

```ts
export interface WorkspaceFileRevision {
  mtimeMs: number
  size: number
}

export interface WorkspaceFile {
  path: string
  content: string
  revision: WorkspaceFileRevision
}
```

The revision is a duplicate-event suppression and revalidation aid, not a durable file
identity. Equal revision means the frontend can retain its existing content and viewer
state. Different revision means content is replaced. A 404 means the path is missing.

The code/media viewer proposal's blob responses should expose equivalent validators
when implemented, either in headers or metadata. This proposal does not require
persisting revisions across frontend reloads.

## Freshness controller

Maintain a monotonically increasing invalidation generation per workspace. The value is
runtime-only:

```ts
interface WorkspaceFileInvalidation {
  generation: number
  paths: readonly string[] | null
}
```

`paths: null` means the exact paths are unknown and all loaded listings/open files are
potentially stale. Path lists are hints; correctness must not depend on receiving every
individual filename.

### Triggers

#### 1. Manual refresh

Explorer and active-file refresh actions bump the selected workspace generation with
`paths: null`. One common action avoids divergent tree/content freshness semantics.

#### 2. Pi tool events

On `tool_execution_end`, schedule a debounced invalidation for the workspace belonging
to the event's session. Resolve that workspace from session state; do not implicitly
use whichever workspace is selected when the timer fires.

Use a per-workspace debounce rather than the current single last-write-wins Git timer.
Known read-only tools may be skipped only through an explicit allow-list. Unknown tools
must invalidate because extension tools and shell commands may write files.

This signal is intentionally broad. Revision comparison and lazy inactive-tab refresh
make duplicate or read-only invalidations inexpensive.

#### 3. Filesystem-watch SSE

Subscribe while a project workspace view is mounted. On connection and reconnection,
the backend first emits a full-rescan invalidation because events may have been missed
while disconnected.

#### 4. Visibility/focus recovery

When the document becomes visible after being hidden, issue one full invalidation for
the selected workspace. This covers watcher interruptions and changes made while the
frontend was suspended.

### Explorer application

On a new generation, `FileExplorer`:

- re-fetches root plus every directory represented in its loaded directory map;
- keeps old `entries` while marking each request as refreshing;
- preserves `expandedPaths` and `filter`;
- uses per-directory request versions or abort signals so an older response cannot
  overwrite a newer generation;
- applies successes independently, so one unreadable directory does not blank the
  entire tree.

Refreshing loaded collapsed directories is acceptable because their cached children
must be current when reopened. If this becomes expensive, collapsed directories may
instead be marked stale and refreshed on expansion without changing the public
invalidation contract.

### Open-file application

On a new generation, `FileContentPane`:

- immediately revalidates the active file;
- marks other cached open files stale;
- revalidates a stale file before/when it becomes active;
- retains the last successful content during the request;
- compares revisions before replacing content;
- represents 404 separately from transient errors;
- never closes a tab solely because refresh failed.

The file state should distinguish initial loading from refresh:

```ts
type FileFreshness = 'loading' | 'ready' | 'checking' | 'stale' | 'missing' | 'error'
```

A previous successful value may coexist with `checking`, `missing`, or `error` so the
UI can explain that it is showing a last-known version.

## Filesystem-watch service

Add a backend-owned capability, for example:

```text
server/features/files/workspace-watcher.ts
```

and a same-origin endpoint:

```text
GET /api/files/watch?cwd=<workspace>
Accept: text/event-stream
```

### Lifecycle

- Validate and canonicalize `cwd` through the existing working-directory boundary.
- Keep one watcher per canonical workspace with subscriber reference counting.
- Start on the first subscriber and close it after the last subscriber leaves.
- Close all watchers when the backend exits.
- Use an `AbortController`/explicit close path so teardown is deterministic.
- Backend restart may lose events; the reconnect-time full rescan restores truth.

The watcher belongs to the backend, like browser and embedded-terminal capabilities.
It does not belong to `server/manager.ts`, and no manager runtime file changes are
needed.

### Event coalescing

Use Node's recursive `fs.watch` support available under the project's Node 24 runtime.
Coalesce bursts for approximately 100–250 ms. Emit relative normalized paths when
provided, with a bounded maximum such as 256 paths per batch:

```ts
export interface WorkspaceFileChangeBatch {
  paths: string[]
  rescan: boolean
}
```

Set `rescan: true` when:

- the platform omits `filename`;
- the path cannot be safely normalized beneath the workspace;
- the batch exceeds its path limit;
- the watcher reports an error;
- the SSE connection is new or reconnected.

Do not expose absolute host paths. Do not claim whether a path was created, renamed,
deleted, or changed when the platform event cannot prove it.

`fs.watch` is explicitly an invalidation mechanism, not the data source. Linux/macOS
inode replacement, Windows root rename/delete behavior, network filesystems, virtualized
mounts, and missing filenames all require the fallback rescan behavior.

### Event storms

Generated files and dependency trees can produce large bursts. Requirements:

- one coalescing timer per watched workspace;
- bounded path set and payload size;
- collapse overflow to one `rescan: true` event;
- never queue an unbounded event history;
- do not log every individual filesystem event;
- frontend refreshes are generation-based and debounced so duplicate Pi/watcher events
  converge.

No ignore list is required for correctness in v1. Add one only from measured event
volume, because ignored paths must stay consistent with what the explorer exposes.

## Removing the external terminal launcher

`Terminal` means the embedded viewer tab after this change.

### Retarget existing entry points

Keep:

- command ID `open-terminal`;
- its user-configurable shortcut, including the current default;
- the right-rail Terminal action;
- the command-palette label `Open terminal`.

Change their execution to the same workspace-state action:

```ts
openEmbeddedTerminal(workspacePath, terminalId)
```

which sets `terminalOpen: true` and activates the terminal view for that exact
workspace. This keeps existing shortcut customizations useful and gives every terminal
entry point one meaning.

### Remove obsolete surfaces

Remove:

- `POST /api/terminal` (the root launcher route only);
- `openTerminal()` from `src/api.ts`;
- `server/features/terminal/launcher.ts`;
- `test/terminal-launcher.test.ts`;
- external-terminal imports and command execution from `App.tsx`;
- `terminalCommand` state and the `pi-livecraft.terminal-command` read/write path;
- the **External terminal command** field and validation in Livecraft settings;
- corresponding settings props and CSS;
- launcher documentation from frontend/backend terminal READMEs.

Do not remove or alter `/api/terminal/instances/:terminalId/*`,
`TerminalView.tsx`, `server/features/terminal/session.ts`, xterm dependencies, or their
focused tests.

An old `pi-livecraft.terminal-command` localStorage value may remain inert in existing
browser profiles; no compatibility reader or migration is required. The removed key
must no longer be registered as a current resettable preference. Stale `open-terminal`
shortcut overrides remain valid because the command ID is retained.

## HTTP and SSE boundaries

All browser communication continues through `src/api.ts`:

- `subscribeWorkspaceFileChanges(workspacePath, callbacks)` owns EventSource creation,
  parsing, reconnection assumptions, and disposal;
- components do not construct `/api/files/watch` URLs directly;
- malformed SSE payloads are ignored or surfaced through the existing client logging
  path without breaking the subscription;
- file reads and directory listings continue through their existing typed API methods.

Add shared types only for values crossing HTTP/SSE boundaries. Workspace viewer-state
persistence types remain frontend-local.

## Security and failure handling

- Canonicalize watcher workspaces server-side; never trust a client path as an event
  root.
- Emit only relative paths and bounded event batches.
- File reads and listings retain their existing realpath containment checks.
- A watcher event never grants access to a file and never carries file contents.
- Symlink and platform watcher behavior cannot weaken the read/list boundaries.
- Watch errors degrade to rescan/manual refresh rather than crashing the backend.
- Malformed localStorage state fails to an empty workspace viewer state.
- Restored file paths are validated as relative, non-traversing UI state before use;
  the backend still performs authoritative validation.
- No persisted viewer state can launch a client-provided executable or terminal
  command after the external launcher is removed.

## Architecture and ownership

- `src/features/workspace/workspace-viewer-state.ts` owns state invariants,
  persistence, bounds, and pure transitions.
- `App.tsx` selects the current workspace entry, handles cross-feature commands/events,
  and passes state/actions to the pane.
- `src/features/files/` owns refresh controls, file cache freshness, tree refresh, and
  visual states.
- `src/api.ts` owns the file-watch EventSource boundary.
- `server/features/files/workspace-watcher.ts` owns watcher lifecycle and event
  coalescing.
- `server/backend.ts` owns route validation and SSE attachment.
- Browser and terminal services retain their existing backend ownership and identity.
- `server/manager.ts` remains unchanged.

## Implementation outline

1. ✅ Add the pure workspace viewer-state model, sanitizing reader/writer, bounds, and
   transition tests.
2. ✅ Replace flat `App` viewer state with the workspace-keyed map while preserving
   existing open/close fallback behavior.
3. ✅ Restore file/browser/embedded-terminal tabs per workspace and register the storage
   key with Livecraft reset.

Steps 1–3 landed in commit `1211624`. The implementation added
`workspace-viewer-state.ts` (pure model), `useWorkspaceViewerState.ts` (React hook),
and 37 focused tests. `App.tsx` lost 50 lines: four flat `useState` calls
(`openFilePaths`, `activePaneView`, `browserOpen`, `terminalOpen`), the
`handleWorkspaceSelected` callback, and ~50 lines of inline fallback logic in JSX.
`onWorkspaceSelected` was removed from the `useWorkspaceSessions` interface. Workspace
switching is now a map-key lookup with zero viewer-state `setState` calls. Two latent
bugs were fixed: `browserOpen`/`terminalOpen` leaking between workspaces, and a stale
closure in the `onClose` fallback. The hook was also added to
`useWorkspaceViewerState.ts` instead of `App.tsx`, which exports the `PaneView` type
from `workspace-viewer-state.ts`.
4. Retarget `open-terminal` command, shortcut, and rail action to the embedded terminal
   tab.
5. Remove the obsolete external-terminal route, API, launcher, setting, CSS, tests, and
   documentation.
6. Extend workspace file reads with revision metadata and add refresh/missing/error
   cache states.
7. Add manual explorer/file refresh actions and generation-based refresh that preserves
   expansion and content.
8. Add workspace-correct debounced invalidation from Pi tool events and visibility
   recovery.
9. Add the backend watcher, SSE route, frontend subscription, coalescing, reconnect
   rescan, and failure fallback.
10. Update feature and architecture documentation, then validate visually with the
    shared browser.

Expected implementation files:

- `src/features/workspace/workspace-viewer-state.ts` — ✅ new
- `src/features/workspace/useWorkspaceViewerState.ts` — ✅ new (React hook)
- `src/features/workspace/useWorkspaceSessions.ts` — ✅ removed `onWorkspaceSelected`
- `src/features/workspace/README.md` — ✅ documented per-workspace viewer state
- `src/features/settings/livecraft-preferences.ts` — ✅ registered reset key
- `test/workspace-viewer-state.test.ts` — ✅ new (37 tests)
- `src/App.tsx` — ✅ replaced flat state with hook
- `src/api.ts`
- `shared/types.ts`
- `src/features/files/FileExplorer.tsx`
- `src/features/files/FileContentPane.tsx`
- `src/features/files/files.css`
- `src/features/files/README.md`
- `server/features/files/workspace-watcher.ts` — new
- `server/features/files/README.md` — new or updated if introduced during implementation
- `server/workspace-file.ts`
- `server/backend.ts`
- `src/features/terminal/README.md`
- `server/features/terminal/README.md`
- `src/features/settings/SettingsPanel.tsx`
- `src/features/settings/LivecraftSettings.tsx`
- `src/features/settings/settings.css`
- `src/features/settings/livecraft-preferences.ts` — ✅ done
- `src/features/commands/command-registry.ts` only if its terminal description changes
- `docs/ARCHITECTURE.md`
- `test/workspace-file.test.ts`
- `test/workspace-watcher.test.ts` — new
- embedded terminal client/session tests as affected
- `server/features/terminal/launcher.ts` — remove
- `test/terminal-launcher.test.ts` — remove

The implementation must inspect the working tree immediately before deleting the two
launcher files and obtain deletion approval if the implementation request has not
already explicitly authorized their removal.

## Validation

Focused automated coverage (✅ = covered by `test/workspace-viewer-state.test.ts`):

- ✅ malformed/old-version viewer state fails safely;
- ✅ workspace records and file tabs are bounded and deduplicated;
- ✅ A → B → A restores distinct ordered tabs and active views;
- ✅ invalid active views follow the documented fallback order;
- ✅ Browser and Terminal openness/selection do not leak between workspaces;
- the `open-terminal` command and rail action open the embedded terminal for the
  selected workspace;
- expanded tree directories remain expanded across refresh;
- stale directory/file responses cannot overwrite newer generations;
- unchanged revisions do not replace viewer state;
- changed, missing, and failed file reads produce distinct states;
- watcher batches paths, caps overflow, handles missing filenames, emits rescan on
  connect/error, and closes when unsubscribed;
- watcher events never expose absolute paths;
- obsolete `POST /api/terminal`, custom terminal setting, and launcher imports no
  longer exist;
- existing embedded-terminal replay, input ordering, resize, restart, and backend
  lifecycle tests still pass.

Suggested commands:

```bash
npm test -- test/workspace-viewer-state.test.ts
npm test -- test/workspace-file.test.ts
npm test -- test/workspace-watcher.test.ts
npm test -- test/terminal-client.test.ts
npm test -- test/terminal-session.test.ts
npm run lint
npm run typecheck
npm run build
```

Visual verification with the `livecraft-browser` skill:

- create distinct file/browser/terminal tab arrangements in two workspaces and switch
  repeatedly;
- reload the frontend and confirm serializable tab state restores;
- verify the embedded shell continues producing output while its workspace is hidden
  and replays correctly when restored;
- add, modify, atomically save, rename, and delete files through an agent, the embedded
  terminal, and an external editor;
- verify Markdown and future CodeViewer content refresh without losing the active tab
  or tree expansion;
- disconnect/restart the backend and confirm watcher reconnection causes a full rescan
  while terminal loss is represented honestly;
- exercise manual refresh while live watching is unavailable;
- inspect hover, focus-visible, active, disabled, refreshing, updated, missing, and
  error states in light/dark themes, at narrow pane width, with long paths, and at the
  existing responsive boundary.

## Acceptance criteria

- ✅ Each canonical workspace owns and restores its own ordered file tabs, active view,
  Browser-tab openness, and embedded-Terminal-tab openness.
- ✅ Switching workspaces never copies or clears another workspace's viewer state.
- ✅ Reload restores serializable viewer state without persisting file content, shell
  output, frames, blobs, or false backend-process status.
- Restoring Terminal reattaches to the workspace-scoped embedded terminal session and
  never launches a separate local terminal application.
- The existing `open-terminal` command, shortcut, and rail action activate the embedded
  terminal tab.
- The external terminal command setting, frontend API, root backend route, launcher,
  tests, and documentation are removed without affecting embedded terminal routes.
- Manual refresh is obvious in both the explorer and active file header.
- Agent tool completion, filesystem events, visibility recovery, and manual action all
  converge on one per-workspace invalidation contract.
- Tree refresh preserves loaded rows, filter, and expanded paths.
- Open files automatically show changed content, clearly show deleted/error states,
  and never close solely because refresh failed.
- Watcher events are bounded invalidation hints; reconnect, ambiguity, overflow, and
  errors cause a safe rescan.
- A failed watcher does not prevent manual or agent-event refresh.
- No manager lifecycle, file editing, database, state library, or external-terminal
  compatibility layer is introduced.

## Sources

Patterns reviewed during design:

- [omp-web](https://github.com/ddallabenetta/omp-web) — refresh keys that preserve
  expansion and per-open-file SSE watching with metadata deduplication.
- [OpenHands](https://github.com/OpenHands/OpenHands) — event-classified query
  invalidation, mutation counters, and scoped persisted file-tab state.
- [Node.js 24 `fs.watch` documentation](https://nodejs.org/docs/latest-v24.x/api/fs.html#fswatchfilename-options-listener)
  — recursive support and platform caveats.

These projects inform the behavior. Implementation should use Livecraft's existing
components, API boundary, backend lifecycle, and storage patterns rather than copying
their state stacks.
