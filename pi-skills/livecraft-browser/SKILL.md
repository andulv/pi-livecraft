---
name: livecraft-browser
description: Drive this workspace's shared browser when testing web apps, verifying UI changes end to end, or browsing localhost dev servers. Attaches playwright-cli to the Livecraft-owned Chrome that the human watches live in the viewer pane. Never launch a separate browser for web work.
---

# Livecraft shared browser

This workspace has one shared headless Chrome owned by the Livecraft backend.
The human watches it live in the Livecraft viewer pane: every page you open and
every action you take is visible to them in real time. Attach to this browser;
do not launch your own.

## Prerequisites

`playwright-cli` (from `npm i -g @playwright/cli`). When the global command is
unavailable, run commands through `npx` instead, for example
`npx -y @playwright/cli@latest snapshot`.

## Connect

1. Ensure the browser is live and read its endpoint. The backend owns it; its
   port defaults to 43121 (`PI_LIVECRAFT_BACKEND_PORT` overrides):

   ```bash
   curl -sf -X POST "http://127.0.0.1:${PI_LIVECRAFT_BACKEND_PORT:-43121}/api/browser/instances/main/start" \
     -H 'Content-Type: application/json' \
     -d "{\"workspacePath\":\"$PWD\"}"
   ```

   The response is a status JSON: `state` should be `live` and `endpoint` holds
   the CDP URL. The environment usually carries the same endpoint already in
   `LIVECRAFT_BROWSER_URL`; prefer it when it works, and fall back to the
   response's `endpoint` when it does not (a rare port collision can shift it).

2. Attach once per browser lifetime. The session is already named for this
   workspace through `PLAYWRIGHT_CLI_SESSION`, so plain commands find it:

   ```bash
   playwright-cli attach --cdp="$LIVECRAFT_BROWSER_URL"
   ```

3. Drive with ordinary playwright-cli commands. Snapshots list interactive
   elements with refs like `e15`; use those refs for actions:

   ```bash
   playwright-cli goto http://localhost:3000
   playwright-cli snapshot
   playwright-cli click e15
   playwright-cli fill "#email" "user@example.com"
   playwright-cli screenshot
   ```

## Rules

- **Detach, never close.** `playwright-cli detach` disconnects you and leaves
  the shared browser running for the human's pane. Never run `close`,
  `close-all`, or `kill-all` on this browser.
- The profile is temporary: logins and storage do not survive a browser
  stop/start. Save what you need with `state-save` before a planned stop.
- Viewport changes with `playwright-cli resize <width> <height>`; the pane's
  live view follows the emulated viewport.
- Raw CDP stays available: the same endpoint accepts any CDP client for quick
  evaluation, and the backend forwards native input through
  `POST /api/browser/instances/main/input` (what the pane itself uses).
