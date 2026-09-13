# Session title authority refactor

Status: **implementation plan — not implemented**. This plan replaces frontend-only
auto-naming with one durable Pi-owned title flow. It intentionally includes the
frontend reconciliation work required to prevent stale session scans from regressing a
newer live title.

## Purpose

Make session naming reliable and conceptually simple:

- Pi's persisted `session_info` name is the only durable title authority.
- The manager supplies a deterministic fallback after the first accepted normal prompt.
- An optional Pi auto-title extension may replace that fallback later.
- The frontend displays manager events immediately but never invents an authoritative
  title.
- Filesystem scans project persisted state and provide compatibility for older unnamed
  sessions; they cannot overwrite fresher live state.

This is an architectural replacement for the current race-prone naming paths, not a
polling or refresh-frequency workaround.

## Existing contracts

- [`docs/ARCHITECTURE.md`](/docs/ARCHITECTURE.md): the manager alone owns Pi RPC
  processes; Pi events reach the frontend through backend SSE.
- [`docs/MANAGER-LIFECYCLE.md`](/docs/MANAGER-LIFECYCLE.md): manager runtime imports
  must be declared, and changes take effect only after the user requests the guarded
  restart.
- [`src/features/workspace/README.md`](/src/features/workspace/README.md):
  `useWorkspaceSessions` owns session-list reconciliation; scans occur on structural
  changes and explicit refresh, not after every message.
- [`docs/HOW-TO-TALK-TO-PI.md`](/docs/HOW-TO-TALK-TO-PI.md): Livecraft uses Pi's public
  RPC protocol. Pi's `set_session_name` command persists the name and emits
  `session_info_changed`.

## Current problem

Three places currently act as naming mechanisms:

1. An optional ambient Pi extension may asynchronously generate and persist a title.
2. `titleSessionFromPrompt` derives a browser-only fallback after a successful prompt.
3. `readPiSession` derives the same fallback while scanning JSONL when no persisted
   name exists.

The frontend also maintains separate live (`sessions`), persisted (`recentSessions`),
and pending-row (`sentSessions`) collections. These collections are legitimate, but
`refreshSessions` currently treats a completed filesystem scan as newer than existing
live state. A scan started before `session_info_changed` can therefore overwrite the
new title and remove the pending row that held the optimistic title.

The live and persisted collections should remain separate because they represent
running processes and session history respectively. Their title precedence should no
longer be implicit in the order of React state updates.

## Target architecture

```text
first accepted ordinary prompt
          │
          ▼
server/manager.ts derives deterministic fallback
          │  Pi public RPC: set_session_name
          ▼
Pi appends session_info and emits session_info_changed
          │
          ├── manager summary updates
          ├── SSE updates the browser immediately
          └── later filesystem scans read the persisted name

optional LLM auto-title extension
          │  may set a better name later
          └── follows the same Pi event and persistence path
```

There may be multiple **title producers**, but there is only one authority and storage
format: Pi's persisted session name.

### Naming invariants

1. `"New session"` is a display placeholder, not persisted fallback state.
2. After Pi accepts the first ordinary string prompt for an unnamed session, the
   manager derives `fallbackSessionTitle(prompt)` and requests
   `set_session_name`.
3. The manager performs fallback naming only after prompt acceptance. It must not set
   a name before `before_agent_start`, because an auto-title extension may use the
   initially unnamed state to decide whether to generate a title.
4. If a real name arrives before the manager applies its fallback, the manager does
   not replace it. A later generated or manually assigned Pi name always replaces the
   fallback through normal `session_info_changed` handling.
5. Slash commands, blank messages, non-string messages, steering/follow-up commands
   other than a `prompt`, and rejected prompts do not trigger fallback naming.
6. A title-write failure does not turn an already accepted prompt into a failed prompt.
   The manager reports/logs the naming failure and leaves the session usable; a later
   ordinary prompt may retry while it remains unnamed.
7. Browser refresh, backend restart, and SSE reconnection do not change the chosen
   title. A guarded manager restart retains it because Pi persisted it.
8. Manual rename continues to use Pi's `set_session_name` RPC path and has the same
   authority as an extension-generated title.

### Projection and freshness invariants

- `sessions` remains the manager's live process view.
- `recentSessions` remains the filesystem history view used by the sidebar.
- `sentSessions` remains only for showing a newly started session before the JSONL scan
  can include it; it no longer owns fallback naming.
- A `session_info_changed` event is applied to every currently visible projection of
  the matching session, keyed by session id and canonical session path.
- A refresh response cannot regress a title learned from a live event while that
  refresh was in flight.
- For a live session, its current non-placeholder manager name overlays the matching
  recent row. Filesystem metadata fills the name only while the live session remains
  unnamed.
- Once a recent row replaces a pending row, the reconciled title is copied into that
  recent row before the pending row is removed.

The reconciliation must be one explicit controller operation rather than independent
`setSessions`, `setRecentSessions`, and `setSentSessions` decisions with accidental
precedence. A small pure helper may calculate the next collections; the hook remains
the state owner.

## Implementation plan

### 1. Persist the deterministic fallback at the manager boundary

Update `server/manager.ts` in `sendCommand`:

- Identify an eligible prompt from the accepted command's trimmed string message.
- Await the original prompt response first.
- If the response is successful and the managed session is still unnamed, derive the
  title with `fallbackSessionTitle`.
- Send `set_session_name` through `requestPi`, allowing the ordinary
  `session_info_changed` event handler to update and broadcast state.
- Do not manually synthesize a Pi event or write JSONL.
- Isolate failure of this secondary RPC from the accepted prompt response.

Keep the check next to prompt forwarding: the manager sees prompts from every client,
continues running across backend/browser restarts, and is the only correct owner of
follow-up RPC work on a managed Pi process.

Import `shared/session-title.ts` as a runtime dependency and add it to
`server/manager-runtime-files.json`. Do not restart the manager or supervisor during
implementation; the UI must expose the normal guarded restart.

The fallback should be requested promptly after acceptance. The implementation must
re-check the latest manager summary immediately before issuing it so a title event
already received from an extension or manual action wins. The expected optional
extension ordering is: begin asynchronous generation while unnamed, manager persists
its immediate fallback, extension persists its improved title when ready.

### 2. Reconcile live and persisted session projections explicitly

Refactor the completion path in
`src/features/workspace/useWorkspaceSessions.ts` so it produces a reconciled snapshot
before committing state:

- Match sessions by id and, where available, canonical `sessionPath`.
- Preserve a non-placeholder live title over a conflicting filesystem title.
- Overlay the selected live title into the matching `RecentSession`, because the
  sidebar renders recent rows.
- Let a filesystem title fill an unnamed live summary, preserving support for reopened
  and inactive sessions.
- Preserve title events received while either `listSessions` or
  `listRecentSessions` was in flight. Use an explicit refresh/event revision or a
  synchronous per-session live-name overlay; do not rely solely on React render timing
  or closure state.
- Reconcile `sentSessions` in the same calculation. Remove a pending row only after its
  matching recent row contains the chosen title and metadata.
- Preserve the existing refresh-version rule that rejects responses superseded by a
  newer workspace refresh.

Put pure matching/precedence logic in the smallest workspace-owned module (the existing
`sidebar-sessions.ts` is appropriate for a pure rule), while orchestration and state
commits remain in `useWorkspaceSessions` as required by the feature contract.

Do not introduce a combined backend endpoint, polling, a refresh after every message,
or a new global state abstraction.

### 3. Remove frontend title production

After manager persistence and reconciliation are covered:

- Remove `titleSessionFromPrompt` from `useWorkspaceSessions` and its public return
  value.
- Remove the call and dependency from `App.tsx`'s composer send path.
- Remove the frontend import of `fallbackSessionTitle` if no longer used there.
- Keep `retainNewSession` after successful ordinary prompts; it controls empty-session
  lifecycle and is unrelated to naming.
- Keep `renameSession` (or rename it to reflect event application) for applying manager
  names consistently to live, recent, pending, and pinned rows.

The browser may still show `"New session"` briefly between prompt acceptance and the
Pi title event. It must not fabricate a separate title to hide that normal event
latency.

### 4. Retain the scanner only as projection and legacy compatibility

Keep `fallbackSessionTitle` usage in `server/pi-session-store.ts` for JSONL files that
have messages but no persisted `session_info` name. This supports sessions created by
older Livecraft versions or other Pi clients.

Clarify this role in comments: scanner derivation is not the live auto-naming
mechanism. The latest persisted `session_info` entry continues to win whenever present.
Do not migrate or rewrite historical JSONL files during scans.

### 5. Align documentation

Update `src/features/workspace/README.md` to state:

- deterministic fallback naming is persisted by the manager through Pi;
- optional generated titles use the same Pi event path;
- session-list reconciliation protects fresher live names from stale scans;
- `sentSessions` is pending-row metadata, not a naming authority.

Update broader architecture documentation only if implementation changes a documented
boundary. This plan does not move process ownership or alter the HTTP/SSE protocol.

## Tests

### Manager integration

Extend `test/manager.integration.test.ts` and its fake Pi process to prove:

1. The first accepted ordinary prompt on an unnamed session is followed by exactly one
   `set_session_name` with the shared deterministic fallback.
2. A slash command, rejected prompt, or already named session does not receive the
   fallback command.
3. A later `session_info_changed` generated name replaces the fallback in manager list
   results and emitted events.
4. Failure of `set_session_name` does not change the successful prompt response or
   leave manager activity accounting stuck.
5. Process reassignment still waits for all in-flight requests; fallback naming must
   use the existing `requestPi` accounting.

Adjust the fake Pi's current rename-only assertion so it can distinguish manual rename
from manager fallback names without weakening unrelated protocol assertions.

### Frontend reconciliation

Add focused pure tests, preferably in `test/sidebar-sessions.test.ts` or a narrowly
named workspace reconciliation test, for:

1. A filesystem refresh started before `session_info_changed` cannot replace the event
   title when it completes afterward.
2. A non-placeholder live generated title overrides an older filesystem fallback.
3. A filesystem title fills an unnamed live session.
4. Replacing a pending row with a recent row preserves the selected title.
5. Sessions with the same id/path matching rules are not duplicated.

### Session store

Keep existing `test/pi-session-store.test.ts` coverage proving:

- persisted `session_info` wins over prompt fallback;
- prompt fallback remains available for a legacy unnamed JSONL file;
- the latest persisted name is selected.

Only add a scanner test if the refactor changes those cases; do not duplicate existing
coverage.

## Validation

Run the smallest checks that cover each changed boundary:

```bash
npm run lint
npm test -- test/sidebar-sessions.test.ts test/pi-session-store.test.ts
npm test -- test/manager-runtime.test.ts test/manager.integration.test.ts
npm run typecheck
npm run format:check -- server/manager.ts server/manager-runtime-files.json \
  src/App.tsx src/features/workspace/useWorkspaceSessions.ts \
  src/features/workspace/sidebar-sessions.ts src/features/workspace/README.md \
  test/manager.integration.test.ts test/sidebar-sessions.test.ts
```

If the implementation creates a differently named focused reconciliation test, use
that path in place of `test/sidebar-sessions.test.ts`.

No browser test is required unless implementation changes rendering. The regression is
state reconciliation and should be proved deterministically without timing a real SSE
connection.

## Completion criteria

- A successful first ordinary prompt obtains a persisted fallback without frontend
  title generation.
- An optional later generated title replaces that fallback immediately through SSE.
- Reloading or refreshing cannot regress the visible title to stale filesystem data.
- Restarting the frontend or backend retains the title; accepting a guarded manager
  restart also retains it through Pi history.
- Legacy unnamed session files still receive the deterministic display fallback.
- No polling, per-message scans, new endpoint, direct JSONL writes, or bundled LLM
  dependency is added.
- Manager runtime declaration, focused tests, types, lint, formatting, and affected
  documentation are aligned.
