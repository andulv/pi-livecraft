# Pi skills

Skills Livecraft injects into every persistent Pi session it spawns.

- `livecraft-browser/` teaches the agent to attach `playwright-cli` to this
  workspace's shared browser over CDP instead of launching its own.

`server/pi-process.ts` owns the skill paths (passed via `--skill`) and injects
the matching `LIVECRAFT_BROWSER_URL` and `PLAYWRIGHT_CLI_SESSION` environment.
Keep skill content aligned with the browser feature contracts.
