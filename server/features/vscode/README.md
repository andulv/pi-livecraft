# VS Code backend capability

`launcher.ts` opens the current validated workspace in a new VS Code window and keeps its identity visible when several Git worktrees are open. Each linked worktree receives a stable color distinct from its project's main checkout. Before launch it merges Livecraft-owned title and color values into `.vscode/settings.json`, accepting VS Code JSONC (comments and trailing commas). Existing settings remain semantically intact, although the file is normalized to formatted JSON after the merge.

The generated settings file is added to the worktree's `.gitignore` unless an equivalent `.vscode` rule already exists. Existing `workbench.colorCustomizations` must be an object; malformed or incompatible settings are rejected rather than overwritten.

The launcher tries `code`, then `code-insiders`, uses `--new-window`, and never invokes a shell. HTTP routing and working-directory validation remain in `server/backend.ts`. Main coverage: `test/vscode-launcher.test.ts`.
