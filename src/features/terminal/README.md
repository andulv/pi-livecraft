# Terminal action

Terminal is a direct workspace action rather than a panel widget. Selecting it opens an external terminal in the current workspace and leaves the Livecraft conversation where it is.

## Where it is available

- from the right rail;
- from the command palette;
- from the editable `Open terminal` shortcut, which defaults to `Alt+T`.

Launch errors appear as regular Livecraft notifications.

## Launcher selection

With no custom command, the backend chooses the platform launcher:

- Linux uses `x-terminal-emulator` with the workspace as its working directory;
- WSL uses `wt.exe`, preserves the current distribution when available, and opens at the workspace path;
- native Windows tries Windows Terminal, Alacritty, WezTerm, PowerShell 7, Windows PowerShell, then Command Prompt, stopping at the first launcher that starts successfully. Console-shell targets use the required built-in Windows PowerShell broker, hidden only while it starts the visible terminal.

The terminal starts detached from the backend, so it remains an ordinary external application after launch.

A custom command can be entered in Settings. It must contain `{cwd}`, which the backend replaces with the validated workspace path. Double quotes group arguments; doubled quotes and the existing `\"` form produce a literal quote. Windows path backslashes remain literal, while outside quotes a backslash escapes only whitespace or a quote, so quoted drive and UNC executable paths are preserved. The template is parsed as a command and arguments, never passed through a shell. A configured command does not silently fall back when it fails.

## Ownership and data flow

`App.tsx` exposes the rail action, executes the palette command, and stores the custom template in `pi-livecraft.terminal-command`. Browser requests go through `src/api.ts`.

The [terminal backend capability](/server/features/terminal/README.md) validates the workspace and command template before spawning the external application.

Focused coverage: `test/terminal-launcher.test.ts`.

## Embedded terminal pane

`TerminalView.tsx` renders the workspace-scoped embedded shell in a viewer-pane Terminal tab — distinct from the external-launcher terminal action above, which opens the platform's own terminal app. xterm.js (`@xterm/xterm` 6 + `@xterm/addon-fit`, 5000 scrollback lines) draws the surface; the backend PTY does the rest.

- Output arrives over `subscribeTerminalOutput` as base64 chunks; the pane writes bytes straight into the terminal without a React re-render. Every event carries a byte-offset id, and the subscriber tracks the last seen id so a deliberate reopen can resume without doubling lines (native `EventSource` reconnects carry the id automatically).
- Input goes through `sendTerminalInput`, an ordered one-POST-in-flight queue that merges a backlog of keystrokes into the next request — parallel POSTs have no arrival-order guarantee, and scrambled typing is the failure mode. The terminal takes focus when opened and owns its shortcuts while focused. Ctrl+C sends ETX to interrupt the foreground process unless terminal text is selected; selected Ctrl+C, Ctrl+Shift+C, and Cmd+C retain browser copy semantics.
- Fit drives resize: a `ResizeObserver` fits the grid and reports `cols`/`rows` to the backend. Colors are read from theme variables on mount and re-read when `data-theme` flips, so both themes match without hard-coded colors. A compact status line starts with the workspace path and follows path-like working-directory metadata from standard OSC 7, shell-integration OSC 3008, or terminal-title updates; arbitrary application titles are ignored.
- The session starts when the tab opens and keeps running while the tab is closed or the document is hidden; reopening replays the bounded server-side buffer. A shell that exits shows a Restart affordance; a spawn failure degrades to a "Terminal unavailable" state. Sessions die with the backend restart — the restart table in docs/ARCHITECTURE.md records the asymmetry.

Focused coverage: `test/terminal-client.test.ts` (working-directory metadata, keyboard semantics, ordering/coalescing, and output parsing) and `test/terminal-session.test.ts` (backend contract).
