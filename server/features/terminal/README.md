# Terminal backend capability

`launcher.ts` opens an external terminal application in a validated workspace directory. An empty command selects the platform default: Linux uses `x-terminal-emulator`, WSL preserves its distribution through Windows Terminal, and native Windows tries Windows Terminal in a new window, Alacritty, WezTerm, PowerShell 7, Windows PowerShell, then Command Prompt.

Console-shell targets use the required built-in Windows PowerShell broker, hidden only while it starts the visible terminal. A custom command is a validated `{cwd}` template and is never passed through a shell. Linux and WSL retain the legacy parser: double quotes group arguments, every backslash escapes the following character, and only literal spaces split tokens. Native Windows preserves path backslashes, supports doubled quotes and the existing `\"` quoted-literal form, and treats a backslash outside quotes as an escape only before whitespace or a quote. A custom-command failure is reported directly instead of falling back to a different terminal.

HTTP routing and working-directory resolution remain in `server/backend.ts`. Main coverage: `test/terminal-launcher.test.ts`.

## Embedded terminal sessions

`session.ts` owns workspace-scoped shells inside the viewer pane — a different answer than the external launcher above, which opens the platform's own terminal app. A `TerminalSession` spawns one real PTY (`@lydell/node-pty`, prebuilt-only; the spawn seam also accepts a tmux-backed variant later) with `cwd` = the route-validated workspace, `TERM=xterm-256color`, and `COLORTERM=truecolor`. The pane drives it over the app's SSE + POST contract:

- output: `pty.onData` chunks coalesce on an 8 ms flush window, land in a 256 KB ring buffer of whole chunks, and fan out to SSE subscribers as base64 `output` events tagged with `id:` = cumulative byte offset. A reconnect resumes from the client's `Last-Event-ID` header or a `lastEventId` query param and replays only whole chunks after that offset, so a resume never duplicates output and never begins mid-escape-sequence. Subscribers without an offset get the buffered history once.
- backpressure: a watermark gate pauses (`pty.pause()`) past 512 KB of unflushed output or while a subscriber's SSE socket is congested (`response.write` returned false), and resumes below 128 KB once every socket drains.
- input/resize: `pty.write` / `pty.resize` with validated payloads (`data` ≤ 10 000 chars; `cols`/`rows` integers 1–1000). Resize before start is remembered and applied at spawn.
- lifecycle: `off | starting | live | exited | crashed`. Linux PTYs report signal 0 on normal exit, so only a non-zero signal counts as `crashed`. A restart clears the buffer and resets offsets. Concurrency caps at 4 sessions per workspace (routes answer 429 beyond that), and the registry kills every child when the backend exits.

A shell keeps producing while nobody watches — unlike the browser screencast, releasing the last viewer pauses nothing. Sessions die with the backend; tmux backing is the named durability path (see docs/EMBEDDED-TERMINAL.md). HTTP routing, workspace resolution, and the SSE resume framing stay in `server/backend.ts` and `server/sse-response.ts`.

Focused coverage: `test/terminal-session.test.ts`.
