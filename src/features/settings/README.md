# Settings and preferences

`SettingsPanel` exposes user-editable local preferences. `App.tsx` owns values that coordinate the application; feature-only persistence stays beside the feature that uses it.

## Current ownership

- `commands/` defines commands, default shortcuts, normalization, and conflict detection.
- `settings/` captures shortcut changes and resets them.
- `App.tsx` persists shortcuts, theme, conversation view, workspace restoration, left and right sidebar state.
- `composer/` persists drafts per session.
- `settings/ExtensionSettings.tsx` renders settings that installed Pi extensions published themselves; the values belong to Pi, not to the browser, and are read and written through the [extension settings capability](/server/features/extension-settings/README.md).

Local values stay in browser `localStorage`; never store secrets there. Readers must tolerate missing, malformed, and documented legacy values so a preference cannot prevent startup. The palette and Settings shortcuts remain fixed to keep both surfaces recoverable.

Extension settings are the exception: they live in Pi's agent directory so the same value applies to the `pi` command line, and an extension publishes its own definitions — adding a setting never requires a change here.

## Add a preference

Keep the value with its narrowest owner, expose it in `SettingsPanel` only when users should configure it, and persist it under the `pi-livecraft.` prefix. Add a focused test when parsing, migration, or validation is non-trivial.

Read [how to add a settings tab](/docs/HOW-TO-SETTINGS.md) for the tabbed modal structure, or [commands](/src/features/commands/README.md) for palette entries and shortcuts, or [right sidebar](/src/features/right-sidebar/README.md) for widget state.
