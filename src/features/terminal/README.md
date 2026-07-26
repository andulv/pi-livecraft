# Terminal frontend

This feature opens an external terminal application directly from the rail, command palette, or keyboard shortcut. The backend selects the Linux or WSL launcher when the setting is empty; custom commands must contain `{cwd}`.

The command is editable in Settings and persisted in `pi-livecraft.terminal-command`. Backend coverage: `test/terminal-launcher.test.ts`.
