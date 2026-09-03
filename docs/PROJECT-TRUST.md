# Project trust UI specification

Status: **proposed** — for review before implementation.

## Goal

Make Pi project trust visible for every workspace in Pi Livecraft and let the user
change the exact workspace's saved trust decision without leaving the application.
The UI must explain where an inherited decision comes from and must not imply that a
running Pi process reloads trust-sensitive resources immediately.

Pi project trust gates project-local settings, packages, extensions, themes, prompt
templates, and skills. In RPC mode Pi cannot ask the user for a trust decision. It
uses the closest saved decision from `~/.pi/agent/trust.json`, then falls back to the
global `defaultProjectTrust` setting. The default value, `ask`, behaves as untrusted in
RPC mode.

## Non-goals

- Do not change Pi's trust model or create a separate Livecraft trust store.
- Do not add a Pi RPC command or manager protocol for trust.
- Do not automatically close, restart, or replace a running Pi process after a change.
- Do not initially expose broad actions such as trusting a repository parent, all
  worktrees, the home directory, or every project.
- Do not infer trust from loaded skills or commands. A trusted project may have no
  skills, and an explicitly supplied skill may load in an otherwise untrusted project.
- Do not edit project-local resources as part of changing trust.

## User experience

### Workspace indicator

Each row in the Workspaces section of `WorkspaceSidebar` shows a compact trust icon
beside the existing `Main workspace` or `Worktree` label. The icon must not displace
the branch name or session-status indicator.

The icon has two effective states:

- **Trusted** — project-local resources will be eligible to load in a newly started Pi
  process.
- **Untrusted** — project-local resources will be ignored by a newly started Pi
  process.

The state must not rely on colour alone. Use distinct accessible icons and an
`aria-label`. Trusted should remain visually quiet; untrusted may use the warning
colour because it can explain missing project behavior.

A tooltip gives the decision source:

- `Trusted for this workspace.`
- `Trusted by parent folder: /path/to/parent.`
- `Untrusted for this workspace.`
- `Untrusted by parent folder: /path/to/parent.`
- `Untrusted because Pi's default project trust is “ask”.`
- `Trusted because Pi's default project trust is “always”.`

When no trust-gated project resources are currently detected, append:
`No trust-gated project resources are currently present.` The trust decision still
matters because resources may be added later.

Loading and failed status reads must not present a false trusted/untrusted state.
While loading, omit the icon or use a neutral pending state. On failure, show a neutral
warning icon whose tooltip says that trust status could not be read; route the error
through the existing notification path.

### Workspace actions

The existing workspace `…` menu gains trust actions below `Open in VS Code`:

- If the effective decision is untrusted: `Trust this workspace…`
- If the effective decision is trusted: `Do not trust this workspace`
- If the workspace has an exact saved decision: `Use inherited trust setting`

`Trust this workspace…` opens a confirmation dialog before writing. The message must
state that trusted project settings, packages, extensions, and skills can load or
execute with the user's permissions. The workspace path must be visible in the dialog.

`Do not trust this workspace` and `Use inherited trust setting` may execute directly;
they reduce or remove an authorization. Errors leave the previous UI state intact.

A successful change refreshes trust status for all visible workspaces because changing
an entry can affect descendants. Show a notice:

> Trust updated. Running Pi sessions keep their current resources; close and reopen a
> session to apply the change.

Do not offer an automatic restart in this version. Closing an active session is an
interruption boundary and existing manager restart protections do not apply to an
individual session close.

### Visual contract

The workspace row remains the owning surface. Reuse its current 36 px minimum height,
spacing, menu, focus treatment, and theme tokens from
`src/features/workspace/workspace.css`. The indicator must support light and dark
themes, narrow sidebar widths, long branch names, hover, focus-visible, and disabled or
pending menu actions. No new card or panel is needed.

## Trust model

### Status computation

The backend canonicalizes every requested workspace through the existing working-
directory resolver before consulting Pi trust.

For each canonical workspace, return:

1. the closest saved trust entry, including its path and boolean decision, when one
   exists;
2. whether that entry is exact or inherited;
3. Pi's global `defaultProjectTrust` value;
4. the effective RPC decision;
5. whether Pi detects trust-gated project resources for the workspace.

Effective RPC trust is:

- the closest saved decision, when present;
- otherwise trusted only when `defaultProjectTrust` is `always`;
- otherwise untrusted (`ask` and `never` both reject project resources in RPC mode).

The backend must use Pi's trust implementation rather than reproduce ancestor matching
or file locking. Pi publicly exports `ProjectTrustStore`,
`hasTrustRequiringProjectResources`, and `SettingsManager` from
`@earendil-works/pi-coding-agent`.

### Saved decisions

Mutations always target the canonical exact workspace path:

- `true` writes an exact trusted decision;
- `false` writes an exact untrusted decision, overriding a trusted ancestor;
- `null` removes the exact decision so the workspace inherits again.

The mutation response returns the freshly computed status. The server must not accept
an arbitrary decision path different from the validated workspace path.

### Running process semantics

Pi resolves project trust while starting a process. Changing the saved decision does
not change resources already loaded by a running process, and the public RPC protocol
has no trust mutation or trust reload command.

The indicator therefore describes the saved policy for the next Pi process, not a
promise about the current process. This distinction is mandatory in the success notice
and documentation.

A possible later enhancement may add `ctx.isProjectTrusted()` to the existing session
environment report. That would allow the UI to identify a live session whose startup
decision differs from the saved policy. It is not required for the first version.

## HTTP contract

All browser calls continue through `src/api.ts`.

### Read visible workspace statuses

`POST /api/project-trust/status`

```json
{
  "workspacePaths": ["/canonical/or/user/supplied/path"]
}
```

The backend validates a bounded, non-empty array of unique strings, canonicalizes each
path, and returns one status per canonical path:

```json
{
  "workspaces": [
    {
      "workspacePath": "/canonical/path",
      "trusted": true,
      "savedDecision": true,
      "savedPath": "/canonical/parent",
      "exact": false,
      "defaultProjectTrust": "ask",
      "hasTrustRequiringResources": true
    }
  ]
}
```

`savedDecision` and `savedPath` are `null` when no saved entry applies. `exact` is
`false` in that case. The request should be bounded to the small number of workspaces
returned by project discovery; the implementation must define and test the limit.

### Change an exact workspace decision

`POST /api/project-trust`

```json
{
  "workspacePath": "/path/to/workspace",
  "decision": true
}
```

`decision` is `true`, `false`, or `null`. The backend canonicalizes the workspace,
writes through Pi's trust store, and returns the updated status object. Invalid paths,
non-directories, malformed decisions, and trust-store failures use the existing JSON
error contract.

The API must not expose the complete trust file or unrelated saved paths. It returns
only the closest entry needed to explain the requested workspace.

## Architecture

- `server/features/project-trust/` owns status calculation and trust-store mutations.
- `server/backend.ts` owns routes, body validation, request bounds, and canonical path
  validation.
- `src/api.ts` owns the typed HTTP calls.
- Shared response types live in `shared/types.ts` because they cross the HTTP boundary.
- `useWorkspaceSessions` owns fetching and refreshing trust status alongside workspace
  discovery, without putting persistence logic in the React component.
- `WorkspaceSidebar` owns rendering and user actions.
- Trust does not go through `server/manager.ts`; the manager continues to own only Pi
  process lifecycle and RPC forwarding.

### Pi package resolution decision

Pi Livecraft currently launches a separately installed `pi` executable and does not
list `@earendil-works/pi-coding-agent` as a local runtime dependency. Before
implementation, choose and document how the backend imports the public trust APIs from
the same Pi installation that Livecraft launches. The implementation must avoid a
second package version whose trust behavior can diverge from the running executable.

Preferred direction: extend the Pi installation resolver so it can identify the
package root behind the selected launcher, then dynamically import the public exports
from that package. If reliable same-installation resolution cannot be provided on all
supported platforms, stop for review rather than parsing `trust.json` independently or
silently adding a potentially divergent Pi dependency.

## Security and failure handling

Project trust authorizes code and configuration supplied by a repository. Treat the
mutation as a sensitive local action even though Livecraft listens only on
`127.0.0.1`.

- Require an explicit confirmation before changing a workspace to trusted.
- Canonicalize the workspace and write only that exact path.
- Reuse Pi's lock-safe trust store implementation; do not perform an unlocked JSON
  read-modify-write.
- Never return the full contents of global Pi settings or the trust store.
- Do not follow a client-provided path to trust a parent implicitly.
- Keep the previous status visible and report an error if a read or write fails.
- A malformed trust or settings file must produce an honest unavailable state; never
  fall back to trusted.

## Implementation outline

1. Resolve and load Pi's public trust APIs from the Pi installation used by Livecraft.
2. Add the backend capability and focused unit tests for exact, inherited, default,
   removal, malformed-file, and canonical-path behavior.
3. Add shared types, HTTP routes, request bounds, and `src/api.ts` wrappers.
4. Add trust-status state and refresh behavior to `useWorkspaceSessions`.
5. Add the workspace-row indicator, tooltip text, confirmation, menu actions, and
   notifications.
6. Update the workspace feature README after the behavior ships.
7. Visually verify the workspace list and menu in light and dark themes, at narrow and
   wide sidebar widths, with long branch names and all loading/error states.

Expected implementation files:

- `server/features/project-trust/project-trust.ts` — new
- `server/features/project-trust/README.md` — new
- the Pi installation resolver selected during implementation
- `server/backend.ts`
- `src/api.ts`
- `shared/types.ts`
- `src/features/workspace/useWorkspaceSessions.ts`
- `src/features/workspace/WorkspaceSidebar.tsx`
- `src/features/workspace/workspace.css`
- `src/features/workspace/README.md`
- `test/project-trust.test.ts` — new
- `test/workspace-sidebar.test.ts`

## Acceptance criteria

- Every discovered workspace can display an effective trusted or untrusted state and
  explain whether it came from the exact path, an ancestor, or Pi's global default.
- The user can write trusted, untrusted, and inherited states for the exact workspace.
- Trusting requires an explicit warning and confirmation.
- A mutation never closes or restarts a Pi process.
- The UI clearly says that running sessions retain their current resources.
- Status refresh covers all visible workspaces after a mutation.
- Backend code uses Pi's lock-safe public trust behavior from the same installation as
  the launched Pi process.
- Invalid input and unavailable or malformed configuration fail closed and surface an
  actionable error.
- The indicator and actions remain usable with long names, narrow sidebar widths,
  keyboard navigation, and both supported themes.
