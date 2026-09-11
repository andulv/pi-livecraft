# Embedded terminal specification

Status: **implemented.** The specification and task plan below guided the
implementation; the transport decision is settled (SSE + POST, no WebSocket) and the
dependencies are pinned in `package.json`. Behavior details live in the feature
READMEs and `docs/ARCHITECTURE.md`; this document stays as the decision record.

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
- **No durable sessions in v1.** The session is in-memory; a bounded replay buffer
  covers reconnect within a backend lifetime. Restart survival is a named later path —
  a **tmux-backed** session (see backlog), *not* moving PTYs into the manager. Shape
  `TerminalSession` so the tmux variant swaps in behind unchanged routes and frontend.
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
pane view  ◄──SSE  /api/terminal/instances/:id/stream── TerminalSession ◄──pty.onData──(chunk ring buffer + event ids)
```

- `server/features/terminal/session.ts` (new) owns one PTY process (via the chosen PTY
  addon) and its fan-out. A `TerminalService` keyed by canonical workspace path + terminal id copies
  `BrowserService`'s Map-of-Maps registry and process-cleanup-on-exit. Routes stay in
  `server/backend.ts`; the capability module defines no routes (same boundary rule as
  every other `server/features/` module). The only tmux-affected seam is how the PTY is
  spawned (plain shell vs. `tmux new-session -A`); the registry, fan-out, and routes are
  unaffected.
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

- **Output (PTY → browser):** SSE stream. PTY bytes are arbitrary (ANSI escapes,
  non-UTF-8) — encode each chunk (base64 or a JSON string field) so it is newline-safe,
  as the Browser stream does. Every output event carries an `id:` (cumulative byte
  offset) so a reconnect can resume without duplication (see Reconnect).
- **Input (browser → PTY):** `POST …/input { data }`, but **ordered** — sent through a
  client-side FIFO queue that keeps one POST in flight at a time. Browsers do not
  guarantee ordered delivery of parallel POSTs, so unordered sends can scramble fast
  typing (the same latent issue exists in the Browser tab's input).
- **Resize:** `POST …/resize { cols, rows }` → `pty.resize(cols, rows)`.
- **Reconnect (no double output):** the session keeps a bounded ring buffer of whole
  output **chunks** (target ~256 KB, oldest dropped). A new stream resumes from the
  client's `Last-Event-ID` (auto-sent by `EventSource` on its own reconnect) or a
  `lastEventId` query param (for a deliberate close/reopen, e.g. visibility change),
  replaying only chunks after that offset; a fresh subscriber with neither gets the full
  buffer once. Replaying whole chunks means a resume never lands mid-escape-sequence.
  This replaces naive "replay the whole buffer to every subscriber," which would double
  every line on an automatic reconnect.
- **Backpressure:** fast output is coalesced on a short flush window and the PTY is
  paused/resumed on a byte watermark so a slow client is never overrun (task 4).

WebSocket is recorded as the textbook alternative and rejected above; revisit only if a
measured need appears.

### Terminal environment and encoding

Spawn the shell with `TERM=xterm-256color` and `COLORTERM=truecolor` — without a `TERM`
the shell assumes a dumb terminal and colors and TUI apps break. Treat both sides as
UTF-8: keep `$LANG` UTF-8-capable; `node-pty` assumes UTF-8 from the OS PTY, and
transcoding is planned only if a non-UTF-8 locale is ever required (xterm.js encoding
guidance). Scrollback is a **client-side** xterm.js `Terminal` option (set an explicit
line count), not a spawn setting; the server keeps only the bounded replay buffer.

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

Versions verified against the npm registry at spec time; re-check at install.

- `@xterm/xterm` — pin **`6.0.0`** (current `latest`/stable; `6.1.0-beta.*` is the beta
  line). Pure JS, no native build.
- `@xterm/addon-fit` — the addon build matching xterm 6.x (addons version
  independently; pin the exact version resolved at install). Pure JS.
- **PTY addon** — native; Node has no built-in PTY, so one of these is unavoidable:
  - `node-pty` (Microsoft): its `latest` dist-tag is **still `1.1.0`**, which ships a
    known-broken tarball (darwin `spawn-helper` exec-bit, issue #919) and predates the
    prebuild fixes; the maintained line is the **`beta`** tag, currently
    **`1.2.0-beta.15`** (exec-bit/prebuild fixes landed across beta.9–beta.12). It runs
    an `install` script that compiles via node-gyp when no prebuild matches, so on Linux
    it needs a toolchain (`build-essential` + `python3`) and — because npm RFC #868 now
    blocks install scripts by default, and this repo already gates scripts via the
    `allowScripts` field in `package.json` — it would need an `allowScripts` entry.
  - **`@lydell/node-pty`** (recommended fallback, currently `1.2.0-beta.15`): prebuilt
    binaries only, per-platform (darwin/linux/win × x64/arm64), **no node-gyp, no
    install script** — sidesteps both the toolchain and the `allowScripts` requirement.
    Preferred when the target platform is covered.
  - `@homebridge/node-pty-prebuilt-multiarch`: second fallback with Node 24 prebuild
    targets.

  Decision deferred to install time: verify which builds/loads on the actual target
  (Node ≥24, ABI 134) and pin the exact version. Fail with a clear error and a graceful
  "terminal unavailable" pane state if no PTY loads.

## Milestone 1 — backend terminal session

Tasks are ordered; each lists acceptance criteria and its validation.

1. **Type contracts + module skeleton.** `server/features/terminal/session.ts` with the
   lifecycle state machine and the shared types above; `TerminalService` registry
   surface used by backend routes. Accept: types compile; module exports
   start/stop/status/subscribe/write/resize. Validate: typecheck, lint.
2. **PTY launcher.** Spawn the shell via the chosen PTY addon with `cwd` = validated
   workspace, `TERM=xterm-256color` + `COLORTERM=truecolor` + a UTF-8 environment, and
   default cols/rows; clean up on stop and on backend exit; double start/stop are safe;
   emit `exited`/`crashed` on child exit. Keep the spawn behind one seam so a tmux
   variant can replace it later. Accept: `start()` resolves with status; a color/TUI
   probe renders; kill terminates the child; repeated calls are safe. Validate: unit
   test for lifecycle transitions; opt-in integration smoke gated on a shell being
   present (like the browser smoke test).
3. **Output stream + chunk ring buffer + event ids.** Subscribe to `pty.onData`, store
   whole chunks (never a mid-byte slice) in a size-capped ring buffer that drops oldest
   first, and fan out to SSE subscribers. Tag each event with an `id:` = cumulative byte
   offset. A new subscriber resumes from `Last-Event-ID` (header) or a `lastEventId`
   query param, replaying only chunks after that offset; with neither, replay the whole
   buffer once. Accept: a late subscriber sees prior output exactly once; a reconnect
   with an offset gets no duplicates; replay never begins mid-escape-sequence. Validate:
   unit tests for offset tagging, `Last-Event-ID` slicing at chunk boundaries, and
   buffer bounds (pure), mirroring `test/browser-input.test.ts` style.
4. **Backpressure.** Coalesce PTY output on a short flush window (merge chunks) to cut
   per-event overhead under floods, and pause/resume the PTY on a high/low byte
   watermark so a fast producer (e.g. `cat` of a large file) never overruns the client
   and xterm.js never discards data. Optional stronger form: gate resume on an xterm.js
   `write()`-callback ack. Accept: a multi-MB burst arrives intact and ordered without
   unbounded memory growth. Validate: unit test for the watermark pause/resume logic
   (pure); smoke for a large-output command.
5. **Input + resize forwarding.** `POST …/input` → `pty.write`; `POST …/resize` →
   `pty.resize`, both with validated payloads. Accept: written bytes reach the child;
   resize changes reported `cols`/`rows`. Validate: unit tests for payload parsing/
   bounds; smoke for the write/resize path.
6. **Routes.** In `server/backend.ts`: `start`, `stream` (SSE; `addViewer`/
   `releaseViewer` on `request.on('close')`; honor `Last-Event-ID`/`lastEventId`),
   `input`, `resize`, `stop`, matched by a regex like the browser-instance routes, with
   workspace resolution reused. Accept: routes wired, validated, no capability logic
   leaks into the backend. Validate: route wiring reviewed against the existing SSE
   route; typecheck, lint.

## Milestone 2 — terminal pane

7. **API client + ordered send.** `src/api.ts`: `startTerminalSession`,
   `subscribeTerminalOutput` (an `EventSource`, like `subscribeBrowserEvents`, tracking
   the last seen id and passing `lastEventId` when it reopens the stream),
   `sendTerminalInput`, `resizeTerminal`, `stopTerminalSession`. Input goes through a
   FIFO queue that keeps one POST in flight and may coalesce queued bytes into the next
   request. Accept: typed, no `any`; rapid input arrives in order. Validate: typecheck,
   lint; unit test for the queue ordering.
8. **Terminal surface.** `src/features/terminal/TerminalView.tsx` mounts xterm.js +
   fit addon with an explicit scrollback line count, wires input/output/resize, applies
   theme colors, and renders starting/live/exited/crashed states. Colocate
   `TerminalView.css`. Load the `livecraft-ui` skill before this visual work. Accept: a
   human can run commands, see colored output, run a TUI app (e.g. `top`), scroll back,
   and resize cleanly. Validate: typecheck, lint, visual checklist in both themes at
   pane min/max width.
9. **Viewer-pane tab.** `FileContentPane.tsx` gains a Terminal tab beside Browser (tab
   button + `terminalActive` branch); `App.tsx` lifts open/active state like
   `browserOpen`/`browserActive`. Accept: opening the tab starts a session in the
   workspace dir; switching tabs preserves the terminal. Validate: visual checklist; no
   console errors across tab switches.

## Milestone 3 — polish and documentation

10. **Reconnect + visibility.** Releasing the last viewer keeps the session alive
    (unlike Browser, which pauses capture — a shell must keep running); returning
    reopens the stream with the last seen id so output resumes without duplication.
    Confirm document-hidden behavior matches intent. Accept: backgrounding and returning
    restores the screen with no doubled lines. Validate: manual check; the id-replay
    unit test from task 3 covers the core.
11. **Extract two shared helpers.** Terminal is the second consumer of the SSE+POST
    pattern, which (rule of three) justifies extracting: (a) a backend SSE-response
    helper — headers, event framing, viewer add/release on `request.on('close')`, and
    **optional** id/replay — and (b) the ordered-send queue from task 7. Keep id/replay
    opt-in: the Browser frame stream is idempotent and deliberately has none, so the
    helper must not force it on. Migrating Browser input onto the shared queue is a
    separate follow-up, not a prerequisite. Accept: both features use the helpers with
    no behavior change to Browser. Validate: existing browser tests still pass;
    typecheck, lint.
12. **Documentation.** Add the terminal session to `docs/ARCHITECTURE.md` (new module +
    SSE channel) **and a restart table** there — what survives a frontend reload
    (everything), a backend restart (Pi sessions survive because the manager owns them;
    the browser and terminal do not), and a manager restart (the guarded boundary).
    State honestly that embedded terminals die on backend restart while Pi sessions do
    not, with tmux named as the future durability path. Extend
    `server/features/terminal/README.md` and `src/features/terminal/README.md` to
    distinguish the embedded terminal from the external launcher, update the two
    feature-index READMEs, and flip this spec's status banner. Validate: docs reread;
    routing from `docs/README.md` still accurate.

## Deferred backlog (do not schedule)

**Restart survival via tmux (named path, not scheduled).** Spawn the PTY running
`tmux new-session -A -s <id>`; after a backend restart a fresh PTY re-attaches the
still-live tmux session, so durability lives outside the app and the manager keeps
owning only Pi. Unix-only, with tmux as an optional host prerequisite. Other backlog:
multiple terminal tabs per workspace, split panes, scrollback search/export,
copy-on-select and bracketed-paste tuning, shell/profile selection in Settings,
agent-driven terminals, WebSocket transport if a measured need appears.

## Risks

- **`node-pty` native build / packaging on Node 24.** `latest` (1.1.0) ships a broken
  tarball; the beta line (`1.2.0-beta.15`) needs a toolchain to compile when no prebuild
  matches and an `allowScripts` entry under npm's new default. Mitigation: prefer the
  prebuilt-only `@lydell/node-pty`, pin the exact version, document the prerequisite,
  and keep a graceful "terminal unavailable" pane state if no PTY loads.
- **Output backpressure.** A fast producer can overrun the client and make xterm.js
  discard data. Mitigation: flush-window coalescing plus watermark pause/resume (task
  4); ack-gated resume is the escalation.
- **Input ordering.** Parallel POSTs can arrive out of order and scramble typing.
  Mitigation: the client-side FIFO send queue (task 7).
- **Byte-safe output over SSE.** Arbitrary PTY bytes must not corrupt the event stream;
  chunk encoding (task 3) is the mitigation.
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
