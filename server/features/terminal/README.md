# Terminal backend capability

`launcher.ts` opens an external terminal application in a validated workspace directory. The terminal command is a user-configurable template with a `{cwd}` placeholder.

HTTP routing and working-directory resolution remain in `server/backend.ts`. Main coverage: `test/terminal-launcher.test.ts`.
