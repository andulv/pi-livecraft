# Embedded terminal specification

Status: **proposed — not yet implemented.** A specification and task plan for review,
not a guide. Nothing below is shipped yet; dependency installs and the transport
decision need explicit approval before implementation begins.

## Goal

Give each workspace an interactive shell that renders inside a viewer-pane **Terminal
tab**, running server-side with the repository as its current directory. The human
types in the pane; a real pseudoterminal (PTY) on the backend runs `bash`/`zsh`/`pwsh`
with full TTY behavior (line editing, colors, curses/TUI apps, resize). Humans get a
terminal without leaving Livecraft.

This complements — does not replace — the existing external-launcher terminal
(`server/features/terminal/launcher.ts`), which opens the platform's *native* terminal
app in the workspace directory. That capability stays as-is. The two are different
answers to different needs: "open my real terminal app" vs. "give me a shell inside the
pane."

## Non-goals (decided)

- **No WebSocket transport.** The app's contract is SSE downstream + HTTP POST
  upstream (`docs/ARCHITECTURE.md`). Every external xterm.js example uses a WebSocket,
  but adopting one needs a new server dependency (`ws`; Node ships no WebSocket
  *server*) or hand-rolled RFC 6455 framing — more code and a new dependency for no
  benefit on a `127.0.0.1`, single-user app. See the transport decision below.
- **No replacement of the external-launcher terminal.** Both coexist.
- **No durable/tmux-backed sessions initially.** In-memory session with a bounded
  replay buffer covers reconnect; tmux persistence is a deferred backlog item.
- **No SSH or remote-host terminals.** Local workspace shell only.
- **No new UI library or state manager.** xterm.js is a rendering component, not a UI
  framework; App-level open/active state mirrors the existing Browser tab.

## Architecture

Mirror the Browser feature exactly, swapping Chrome+CDP for a shell+PTY and keeping
SSE+POST. The Browser feature is the proven in-repo template: a backend session owns a
subprocess, fans events to SSE subscribers, ref-counts viewers to pause/resume, and
takes input over POST.

```
pane keys  ──POST /api/terminal/instances/:id/input───► TerminalSession ──pty.write──► shell (cwd = workspace)
pane resize──POST /api/terminal/instances/:id/resize──► TerminalSession ──pty.resize──┘
pane view  ◄──SSE  /api/terminal/instances/:id/stream── TerminalSession ◄──pty.onData──(bounded ring buffer)
```

- `server/features/terminal/session.ts` (new) owns one `node-pty` process and its
  fan-out. A `TerminalService` keyed by canonical workspace path + terminal id copies
  `BrowserService`'s Map-of-Maps registry and process-cleanup-on-exit. Routes stay in
  `server/backend.ts`; the capability module defines no routes (same boundary rule as
  every other `server/features/` module).
- This is a backend capability like Git/quotas/browser, **not** a manager concern —
  `server/manager.ts` stays the sole owner of `pi --mode rpc` processes.
- Frontend `src/features/terminal/TerminalView.tsx` (new) mounts `@xterm/xterm` +
  `@xterm/addon-fit`, wires `term.onData → sendTerminalInput` and SSE `data →
  term.write`, and reports fit rows/cols via `resizeTerminal`. `src/api.ts` remains the
  only browser-to-backend path.
- `src/features/files/FileContentPane.tsx` hosts the Terminal tab beside the Browser
  tab; `src/App.tsx` lifts open/active state the way `browserOpen`/`browserActive` are
  handled today.

### Transport decision

**Recommendation: SSE downstream + HTTP POST upstream**, matching the repo and reusing
the Browser feature's plumbing. On localhost, POST-per-input has negligible latency and
is already how the Browser pane forwards every keystroke successfully.

- **Output (PTY → browser):** SSE stream, one `data` event per chunk. PTY bytes are
  arbitrary (ANSI escapes, non-UTF-8) — encode each chunk (base64 or a JSON string
  field) so it is newline-safe, exactly as the Browser stream sends JSON/base64.
- **Input (browser → PTY):** `POST …/input { data }`, fire-and-forget, like
  `sendBrowserInput`.
- **Resize:** `POST …/resize { cols, rows }` → `pty.resize(cols, rows)`.
- **Reconnect:** the session keeps a bounded output ring buffer (target ~256 KB) and
  replays it to each new SSE subscriber — the analog of the Browser emitting current
  `status`/`url` on subscribe. Covers a dropped tab or a backgrounded mobile browser.

WebSocket is recorded as the textbook alternative and rejected above; revisit only if a
measured need appears.

### Encoding

Treat the xterm.js side as UTF-8. `node-pty` assumes UTF-8 from the OS PTY; keep
`$LANG` UTF-8-capable and transcode only if a non-UTF-8 locale is ever required
(xterm.js encoding guidance). No transcoding layer is planned for the common case.

### Security posture

An embedded shell is a real RCE surface; it stays strictly within the app's
`127.0.0.1`-only, single-user local-trust model.

- Bind nothing new publicly; reuse the existing POST origin checks.
- Validate `workspacePath` through the same resolver the Browser routes use; the shell
  spawns with `cwd` = the validated workspace and never a client-supplied path.
- Cap input payload size and cap concurrent sessions per workspace.
- Do not broaden network exposure or add auth-bypassing surface (AGENTS.md).

## Contracts to define (milestone 1, task 1)

`shared/types.ts`:

- `TerminalInstanceTarget`: `{ workspacePath: string; terminalId: string }` (mirror
  `BrowserInstanceTarget`; first pane uses id `main`).
- `TerminalSessionState`: `'off' | 'starting' | 'live' | 'exited' | 'crashed'`.
- `TerminalSessionStatus`: `{ state: TerminalSessionState; cols?: number;
  rows?: number; shell?: string; error?: string }`.
- Input/resize payload shapes with validated bounds (`cols`/`rows` positive integers
  within sane caps; `data` length-capped string).

## Dependencies (needs approval before install)

- `@xterm/xterm` + `@xterm/addon-fit` — pure JS, no native build.
- `node-pty` — **native addon**, the one caveat. Node has no built-in PTY, so this (or
  an equivalent) is unavoidable for real TTY behavior. On Linux it compiles from source
  (`build-essential` + `python3`); its prebuilt-binary story on **Node 24 (ABI 134)**
  is currently rough (mislabeled linux-arm64 prebuild in `node-pty@1.2.0-beta.2`, issue
  #860; spotty Node-24 prebuilds generally). This repo pins **Node ≥24**, so verify the
  install builds on the target platform and pin a known-good version.

## Milestone 1 — backend terminal session

Tasks are ordered; each lists acceptance criteria and its validation.

1. **Type contracts + module skeleton.** `server/features/terminal/session.ts` with the
   lifecycle state machine and the shared types above; `TerminalService` registry
   surface used by backend routes. Accept: types compile; module exports
   start/stop/status/subscribe/write/resize. Validate: typecheck, lint.
2. **PTY launcher.** Spawn the shell via `node-pty` with `cwd` = validated workspace,
   a UTF-8 environment, and default cols/rows; clean up on stop and on backend exit;
   double start/stop are safe; emit `exited`/`crashed` on child exit. Accept: `start()`
   resolves with status; kill terminates the child; repeated calls are safe. Validate:
   unit test for lifecycle transitions; opt-in integration smoke gated on a shell being
   present (like the browser smoke test).
3. **Output stream + ring buffer.** Subscribe to `pty.onData`, append to a bounded ring
   buffer, fan out to SSE subscribers; new subscribers first receive the buffered
   replay. Accept: a late subscriber sees prior output; the buffer is size-capped and
   drops oldest first. Validate: unit test for buffer bounds and replay ordering
   (pure), mirroring `test/browser-input.test.ts` style.
4. **Input + resize forwarding.** `POST …/input` → `pty.write`; `POST …/resize` →
   `pty.resize`, both with validated payloads. Accept: written bytes reach the child;
   resize changes reported `cols`/`rows`. Validate: unit tests for payload parsing/
   bounds; smoke for the write/resize path.
5. **Routes.** In `server/backend.ts`: `start`, `stream` (SSE; `addViewer`/
   `releaseViewer` on `request.on('close')`), `input`, `resize`, `stop`, matched by a
   regex like the browser-instance routes, with workspace resolution reused. Accept:
   routes wired, validated, no capability logic leaks into the backend. Validate:
   route wiring reviewed against the existing SSE route; typecheck, lint.

## Milestone 2 — terminal pane

6. **API client.** `src/api.ts`: `startTerminalSession`, `subscribeTerminalOutput` (an
   `EventSource`, like `subscribeBrowserEvents`), `sendTerminalInput`, `resizeTerminal`,
   `stopTerminalSession`. Accept: typed, no `any`. Validate: typecheck, lint.
7. **Terminal surface.** `src/features/terminal/TerminalView.tsx` mounts xterm.js +
   fit addon, wires input/output/resize, applies theme colors, and renders
   starting/live/exited/crashed states. Colocate `TerminalView.css`. Load the
   `livecraft-ui` skill before this visual work. Accept: a human can run commands, see
   colored output, run a TUI app (e.g. `top`), and resize cleanly. Validate: typecheck,
   lint, visual checklist in both themes at pane min/max width.
8. **Viewer-pane tab.** `FileContentPane.tsx` gains a Terminal tab beside Browser (tab
   button + `terminalActive` branch); `App.tsx` lifts open/active state like
   `browserOpen`/`browserActive`. Accept: opening the tab starts a session in the
   workspace dir; switching tabs preserves the terminal. Validate: visual checklist; no
   console errors across tab switches.

## Milestone 3 — polish and documentation

9. **Reconnect + visibility.** Releasing the last viewer keeps the session alive
   (unlike Browser, which pauses capture — a shell must keep running); returning
   re-subscribes and replays the buffer. Confirm document-hidden behavior matches
   intent. Accept: backgrounding and returning restores the screen. Validate: manual
   check; buffer-replay unit test from task 3 covers the core.
10. **Documentation.** Add the terminal session to `docs/ARCHITECTURE.md` (new module +
    SSE channel), extend `server/features/terminal/README.md` and
    `src/features/terminal/README.md` to distinguish the embedded terminal from the
    external launcher, update the two feature-index READMEs, and flip this spec's status
    banner. Validate: docs reread; routing from `docs/README.md` still accurate.

## Deferred backlog (do not schedule)

tmux/durable sessions surviving backend restart, multiple terminal tabs per workspace,
split panes, scrollback search/export, copy-on-select and bracketed-paste tuning,
shell/profile selection in Settings, agent-driven terminals, WebSocket transport if a
measured need appears.

## Risks

- **`node-pty` native build on Node 24.** Prebuild coverage is uneven; the install may
  compile from source and needs a toolchain. Mitigation: pin a known-good version,
  document the toolchain prerequisite, fail with a clear error if the shell/PTY is
  unavailable and keep the pane in a graceful "terminal unavailable" state.
- **Byte-safe output over SSE.** Arbitrary PTY bytes must not corrupt the event stream;
  encoding (task 3) is the mitigation.
- **Long-lived shells and resource use.** Cap concurrent sessions; clean up children on
  backend exit (registry mirrors `BrowserService`).
- **Input latency via POST.** Expected negligible on localhost; WebSocket is the
  escalation only if measured latency bites.
- **Security of an embedded shell.** Same local-trust model as the app; do not broaden
  exposure. Workspace-scoped `cwd`, size/rate caps, origin checks.

## Sources (external research)

- xterm.js — terminal renderer, node-pty pairing: https://github.com/xtermjs/xterm.js/
- xterm.js encoding (UTF-8 / node-pty): https://xtermjs.org/docs/guides/encoding/
- xterm.js + node-pty + WebSocket demo (reference pattern):
  https://github.com/freewind-demos/typescript-react-antd-xtermjs-nodepty-web-terminal-demo
- ttyd WebSocket protocol: https://deepwiki.com/tsl0922/ttyd/2.1-websocket-protocol
- code-server reconnection/scrollback behavior: https://github.com/coder/code-server
- node-pty Node 24 / prebuilt-binary issues:
  https://github.com/microsoft/node-pty/issues/860,
  https://github.com/prebuild/prebuild/issues/332
