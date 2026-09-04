# Extension settings backend capability

`readExtensionSettings` and `updateExtensionSetting` own the Pi extension settings document at `~/.pi/agent/extension-settings.json` (or `$PI_CODING_AGENT_DIR/extension-settings.json`). The document is self-describing: each Pi extension publishes its own setting definitions on session start, so this module renders and validates whatever is published without naming any extension. A snapshot reports every published setting with its stored values and the environment variables that currently override them.

One update stores or clears a single value, validated against the published definition: enum membership, numeric minimums, and boolean coercion. `null`, `undefined`, and an empty string clear the stored value so the extension default applies again. Writes replace the document atomically through a temporary file, and unexpected entries are dropped instead of rejecting the document, while invalid JSON fails loudly so a broken hand edit cannot silently reset configured values.

The document is shared with the `pi` command line: the same file backs the `/extension-settings` command in the `pi-extensions` repository, so a value saved here applies to plain `pi` too, and extensions resolve it on their next invocation. Never store secrets here.

HTTP paths and identifier presence checks remain in `server/backend.ts`; this module maps its own `ExtensionSettingsError` to `400` for updates and `409` for an unusable document. No Pi process is involved. Main coverage: `test/extension-settings.test.ts`.
