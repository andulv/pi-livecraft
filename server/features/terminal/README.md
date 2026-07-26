# Terminal backend capability

`launcher.ts` opens an external terminal application in a validated workspace directory. An empty command selects the Linux or WSL default; a custom command is a validated template with a `{cwd}` placeholder.

HTTP routing and working-directory resolution remain in `server/backend.ts`. Main coverage: `test/terminal-launcher.test.ts`.
