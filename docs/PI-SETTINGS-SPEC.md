# Pi settings UI specification

Status: **proposed** — for review before implementation.

## Goal

Let the user view and edit Pi's own settings files from inside Pi Livecraft, and
give Pi Livecraft's own browser-stored preferences a single visible, resettable
home. Both live in the existing settings modal as new tabs.

Pi keeps settings in two JSON files that merge, with the project file overriding
the global one by nested object merge:

| File | Scope |
|---|---|
| `~/.pi/agent/settings.json` (or `$PI_CODING_AGENT_DIR/settings.json`) | Global — all projects |
| `<workspace>/.pi/settings.json` | Project — one workspace |

The feature must present the effective value and its origin per scope, allow both
curated and raw editing, preserve settings the UI does not model, and never imply
that a running Pi process reloads settings immediately.

Pi Livecraft stores ~18 values in browser `localStorage` under the
`pi-livecraft.` prefix. Only theme, shortcuts, and the terminal command are
reachable in the UI today; the rest are invisible and only resettable through
browser developer tools. This feature surfaces the user-facing ones and makes the
remembered layout state resettable.

## Non-goals

- Do not add a Pi RPC command or manager protocol for settings. Pi reads settings
  at process start; `/settings` is TUI-only and does not execute over RPC.
- Do not automatically restart, replace, or reload a running Pi process after a
  change. The manager lifecycle is unchanged.
- Do not model every documented Pi setting as a typed control. A curated set is
  typed; everything else stays editable as raw JSON and is preserved untouched.
- Do not read, render, or edit `~/.pi/agent/auth.json` or any credential store.
- Do not add a code-editor dependency. A validated `<textarea>` is sufficient.
- Do not change Pi's trust model. The project scope only warns when the workspace
  is not trusted; it does not grant trust. See [PROJECT-TRUST.md](/docs/PROJECT-TRUST.md).
- Do not move Pi process ownership or persistence conventions. Extension settings
  remain the pattern this feature copies.

## Rationale for the editing model

`docs` for Pi lists roughly sixty settings keys and grows every release. Mirroring
all of them as typed controls guarantees drift against Pi. Editing only raw JSON
gives no discoverability and no per-key reset. The chosen middle path — a curated
field registry plus a raw JSON escape hatch that preserves unknown keys — keeps the
common settings friendly while remaining complete and drift-resistant. This mirrors
how `ExtensionSettings` renders whatever a self-describing document contains without
naming any extension.

## User experience

### Tab layout

The settings modal gains two tabs and absorbs the standalone Terminal tab:

```
Settings modal
├── Color themes      (unchanged)
├── Shortcuts         (unchanged)
├── Pi settings       ← new: Pi's global and project settings.json
├── Pi extensions     (unchanged)
└── Livecraft         ← new: browser-stored preferences; absorbs Terminal
```

Tab count grows from four to five. The `open-palette` and `open-settings`
shortcuts, the **Reset shortcuts** button, and the **Done** button stay present.

### Pi settings tab

**Scope switch.** A segmented control at the top selects `Global` or
`This project`. The active scope's absolute file path is shown in the small footer
style `ExtensionSettings` already uses. `This project` uses the current workspace
directory; when no workspace is selected it is disabled with the reason stated.

**Curated field rows.** A hand-curated registry of the settings users commonly
change is rendered as typed controls, reusing the control shapes from
`ExtensionSettings` (`enum`/`boolean` as a select that commits immediately, text
and number committing on blur or Enter, a `Reset` button when a value is stored).
The initial registry covers at least:

- Model and thinking: `defaultProvider`, `defaultModel`, `defaultThinkingLevel`,
  `hideThinkingBlock`, `enabledModels`.
- Behavior: `steeringMode`, `followUpMode`, `compaction.enabled`,
  `compaction.reserveTokens`, `compaction.keepRecentTokens`, `retry.enabled`,
  `retry.maxRetries`, `defaultTools`.
- UI and environment: `theme`, `externalEditor`, `markdown.mermaid`, `sessionDir`.
- Global-only: `defaultProjectTrust`, `httpProxy` (disabled in project scope with
  the reason shown).

Each field carries a label, a one-line description, a type, and — where documented —
its Pi default. Dotted identifiers such as `compaction.reserveTokens` address nested
objects.

**Provenance per row.** Each row states where the effective value comes from,
extending the badge pattern already in `SettingRow`:

- set in the active scope → editable, `Reset` clears the key in that scope;
- unset in project scope but set globally → shows the inherited value as a greyed
  placeholder labelled `Inherited from global`, with the write action labelled
  **Override here**;
- unset everywhere → shows the Pi default as a greyed placeholder labelled
  `Pi default`;
- global-only keys in project scope → disabled with `Global setting only`.

Clearing a value removes the key so the lower-precedence value applies again, the
same semantics as clearing an extension setting.

**Raw JSON escape hatch.** An `Edit as JSON` toggle replaces the form with a
`<textarea>` holding the pretty-printed document for the active scope, with
`Save` and `Cancel`. Invalid JSON is rejected loudly with an inline message and no
write. On save the document is written verbatim after parsing; the form does not
reformat or drop keys it does not model.

**Apply semantics.** Because Pi reads settings at process start, the tab shows a
persistent quiet notice after a successful write: *"Saved. Applies to sessions
started from now on."* There is no restart control.

**Trust guard.** Writing `<workspace>/.pi/settings.json` only affects Pi when the
project is trusted. When the workspace has no applicable trust decision, the
project scope shows a warning that Pi will ignore these values until the project is
trusted, linking conceptually to the project trust surface. The write is still
allowed.

**Security.** `auth.json` is never surfaced. `httpProxy` may embed credentials, so
its row and the JSON editor carry the standing "never store secrets shared with
others here" caution. No value is masked.

### Livecraft tab

Two sections plus a reset.

**Preferences** — editable rows for the user-facing values:

- external terminal command (moved from the Terminal tab),
- conversation view and detailed view,
- browser viewport preset,
- pinned models.

**Layout & state** — a collapsed `<details>` block listing the remembered UI
state, each row showing its value with a `Reset` button: workspace/git/right
sidebar widths and collapse flags, file-pane share, last right-sidebar widget, last
selected session, and the workspace (projects) list.

**Reset all Livecraft settings** — a button behind a confirmation that clears every
`pi-livecraft.` key.

A declarative registry drives both sections, so a future preference appears by
adding one entry rather than editing the renderer. `pi-livecraft.quotas` and
`pi-livecraft.environment` are Pi session-status keys, not stored preferences, and
are out of scope.

## Data contract

New shared types in `shared/pi-settings.ts`:

```ts
export type PiSettingsScope = 'global' | 'project'

export type PiSettingValue = string | number | boolean | string[]

export interface PiSettingField {
  /** Dotted key path into settings.json, e.g. "compaction.reserveTokens". */
  id: string
  label: string
  description: string
  type: 'string' | 'number' | 'boolean' | 'enum' | 'string-array'
  options?: string[]
  minimum?: number
  defaultValue?: PiSettingValue
  /** Only writable in the global file. */
  globalOnly?: boolean
}

export interface PiSettingsScopeDocument {
  scope: PiSettingsScope
  /** Absolute path, shown so users know where values live. */
  path: string
  /** Whether the file exists on disk. */
  exists: boolean
  /** Parsed document for this scope, or an empty object. */
  values: Record<string, unknown>
  /** Pretty-printed document text for the raw editor. */
  raw: string
}

export interface PiSettingsSnapshot {
  fields: PiSettingField[]
  scopes: PiSettingsScopeDocument[]
  /** Whether the project scope is available (a workspace is selected). */
  projectAvailable: boolean
  /** Whether the project is trusted, when known. */
  projectTrusted?: boolean
}
```

The field registry is defined once on the server and returned in the snapshot so
the browser renders whatever is published, matching the extension-settings shape.

## HTTP contract

Routing, working-directory resolution, request parsing, and validation stay in
`server/backend.ts`; the capability module owns behavior and persistence.

### Read the snapshot

`GET /api/pi-settings?cwd=<workspace>` returns `PiSettingsSnapshot`. `cwd` resolves
through the existing `resolveWorkingDirectory`; when absent the project scope is
reported unavailable. A settings file that is present but not valid JSON yields
`409` so a broken hand edit surfaces instead of silently resetting values.

### Update one curated field

`POST /api/pi-settings` with `{ scope, cwd, id, value }` stores or clears one field
and returns the refreshed snapshot. `value` of `null`, `undefined`, or `""` clears
the key. The value is validated against the field definition (enum membership,
numeric minimum, boolean coercion, array-of-strings). A `globalOnly` field rejected
in project scope, an unknown `id`, or a validation failure returns `400`.

### Save a raw document

`PUT /api/pi-settings/document` with `{ scope, cwd, text }` parses `text`, rejects
non-object or invalid JSON with `400`, and writes it verbatim. Returns the
refreshed snapshot.

## Architecture

New backend capability `server/features/pi-settings/pi-settings.ts` with a
`README.md`, structurally close to `server/features/extension-settings/`:

- `readPiSettings(cwd)` builds the snapshot from both files.
- `updatePiSetting(scope, cwd, id, value)` reads the target document, sets or
  prunes the dotted key path, pruning now-empty parent objects, validates against
  the field registry, and writes atomically.
- `savePiSettingsDocument(scope, cwd, text)` parses and writes the whole document
  atomically.
- `PiSettingsError` maps to `400`/`409` in the backend, mirroring
  `ExtensionSettingsError`.

Persistence copies the proven extension-settings mechanics: resolve the path per
call (honoring `PI_CODING_AGENT_DIR` so tests can redirect), a missing file yields
an empty document, invalid JSON fails loudly, and every write goes through a
temporary file and `rename` so a concurrent reader never sees a partial write.
Every write preserves keys the field registry does not model.

No Pi process is involved; the module does not use `ManagerClient`.

Frontend:

- `src/api.ts` gains `getPiSettings`, `updatePiSetting`, `savePiSettingsDocument`.
- `src/features/settings/PiSettings.tsx` renders the scope switch, curated rows,
  and raw editor, reusing the row control shapes extracted from `ExtensionSettings`.
- `src/features/settings/LivecraftSettings.tsx` plus
  `src/features/settings/livecraft-preferences.ts` render the registry-driven
  preferences and layout/state rows; the Terminal control moves here.
- `SettingsPanel.tsx` extends `SettingsTabId` and `settingsTabs`, drops the
  `terminal` tab, and threads the new props.
- `src/App.tsx` owns the snapshot state and a `loadPiSettings()` that runs when the
  modal opens and when the selected workspace changes, mirroring how extension
  settings load at `src/App.tsx:865`.
- Styles are colocated in `src/features/settings/settings.css`.

## Security and failure handling

- The application already listens only on `127.0.0.1`; this feature adds no new
  exposure.
- `auth.json` and any credential file are never read or offered.
- A malformed settings file is reported, never silently overwritten.
- Writes are atomic; a failed write leaves the previous file intact.
- Project writes are permitted but flagged when the workspace is untrusted, because
  Pi will ignore them until trust is granted.

## Implementation outline

1. Add `shared/pi-settings.ts` with the contract above.
2. Add `server/features/pi-settings/pi-settings.ts` and its `README.md`; link it
   from `server/features/README.md`.
3. Add the three routes to `server/backend.ts`, reusing `resolveWorkingDirectory`
   and mapping `PiSettingsError` to `400`/`409`.
4. Add `getPiSettings`, `updatePiSetting`, `savePiSettingsDocument` to `src/api.ts`.
5. Extract the reusable setting-row control from `ExtensionSettings.tsx`.
6. Add `PiSettings.tsx`, `LivecraftSettings.tsx`, and `livecraft-preferences.ts`.
7. Update `SettingsPanel.tsx` (tab registry, props, drop Terminal) and `App.tsx`
   (snapshot state, load on open and on workspace change).
8. Colocate styles in `settings.css`.
9. Add `test/pi-settings.test.ts` covering unknown-key preservation, nested set and
   prune, invalid-JSON rejection, atomic replace, dotted-path handling, scope
   precedence, and `globalOnly` rejection in project scope.
10. Update `docs/HOW-TO-SETTINGS.md` (tab table) and
    `src/features/settings/README.md` (ownership) so the contract stays aligned.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm test -- test/pi-settings.test.ts`
- The `livecraft-browser` skill to confirm both tabs render, the scope switch and
  provenance badges behave, the JSON editor round-trips, and Reset clears values.

## Acceptance criteria

- The Pi settings tab reads and writes both `~/.pi/agent/settings.json` and the
  selected workspace's `.pi/settings.json`, with correct effective value and
  provenance per scope.
- Curated fields and the raw JSON editor both persist changes, and a raw save never
  drops keys the form does not model.
- Clearing a field removes its key so the lower-precedence value applies again.
- Global-only fields cannot be written to the project scope.
- Invalid JSON on disk is reported, not overwritten; every write is atomic.
- The Livecraft tab edits the user-facing preferences, resets individual layout
  values, and resets all `pi-livecraft.` keys, with the Terminal command included.
- No credential file is ever read or rendered, and no running Pi process is
  restarted by the feature.
