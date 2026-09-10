# Pi settings backend capability

`readPiSettings`, `updatePiSetting`, and `savePiSettingsDocument` own Pi's own
settings files: `~/.pi/agent/settings.json` (or `$PI_CODING_AGENT_DIR/settings.json`)
for the global scope and `<workspace>/.pi/settings.json` for the project scope.
These are the same files the `pi` command line reads, so a value saved here also
applies to plain `pi`, and Pi resolves it when a session process starts.

A curated field registry (`FIELDS`) describes the settings users commonly change —
their label, group, type, options, minimum, default, and whether they are
global-only. The registry is returned in every snapshot so the browser renders
whatever is published. Keys the registry does not model stay editable through the
raw-JSON editor and are preserved untouched on every write; the field list can grow
without dropping unmodeled keys.

`readPiSettings(cwd)` reports both scopes with their parsed contents, a
pretty-printed `raw` document for the editor, and whether the project scope is
available. `updatePiSetting` stores or clears one field by its dotted key path,
creating intermediate objects on set and pruning now-empty parents on clear, after
validating the value (enum membership, numeric minimum, boolean coercion,
array-of-strings). `null`, `undefined`, an empty string, or an empty array clears
the value so the lower-precedence value applies again. A global-only field rejected
in the project scope, an unknown field, or a validation failure raises
`PiSettingsError`. `savePiSettingsDocument` parses submitted text and writes the
whole document verbatim.

Persistence copies the extension-settings mechanics: paths resolve per call so
tests can redirect `PI_CODING_AGENT_DIR`, a missing file yields an empty document,
invalid JSON fails loudly so a broken hand edit surfaces instead of silently
resetting values, and writes replace the file atomically through a temporary file.
No credential file is read, and no Pi process is involved — the module does not use
`ManagerClient`.

HTTP paths, working-directory resolution, and body validation stay in
`server/backend.ts`, which maps `PiSettingsError` to `400` for updates and raw
saves and `409` for an unusable document. Main coverage: `test/pi-settings.test.ts`.
