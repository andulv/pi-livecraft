# Terminal frontend

This feature opens an external terminal application directly from the rail, command palette, or keyboard shortcut. The backend spawns the configured launcher detached in the selected workspace.

The terminal command template (default: `wt.exe -d {cwd}`) is editable in Settings and persisted in `pi-livecraft.terminal-command`. Backend coverage: `test/terminal-launcher.test.ts`.
