# Embedded terminal shell control proposal

Status: **proposal** — not implemented.

## Goal

Give the user control over how the viewer-pane embedded shell is spawned and stop its
history from mingling with shells outside Livecraft:

1. choose the shell program and its arguments (login shell, custom rc file, init
   command);
2. add environment variables for the spawned shell;
3. keep command history per workspace, so embedded sessions never read or write the
   user's default shell history file.

## Current behavior

`server/features/terminal/session.ts` owns the spawn. `platformShellCommand()` picks
`$SHELL` (fallback `bash`) on Unix and `powershell.exe` on Windows, with **no
arguments**. `terminalEnvironment(process.env)` inherits the backend's environment and
adds only `TERM`, `COLORTERM`, and a missing `LANG`. Consequences:

- the shell reads the user's default rc/profile, so Livecraft cannot opt out or add
  startup behavior;
- bash and zsh fall back to the default `HISTFILE` (`~/.bash_history`,
  `~/.zsh_history`): history is shared with every other terminal of the user, and
  concurrent embedded sessions race on the same file.

The HTTP contract needs no change: routes keep passing only the route-validated
workspace; the config is read server-side where the spawn happens. The status payload
already reports the spawned shell, so the UI reflects the selection without frontend
changes.

## Decisions

- **Config home: server-side Livecraft-owned JSON file next to the backend**, applying
  to all workspaces. Precedent: the app log lives in the repo root, resolved via
  `import.meta.url`. Proposed path: `<repo root>/pi-livecraft-terminal.json`, read at
  each shell start (an edit applies to the next spawned shell; no restart).
- **Missing or malformed file falls back to today's behavior** for the whole file and
  logs one warning through `AppLog`. A bad value never blocks a shell from starting.
- **Schema (all keys optional):**
  ```json
  {
    "command": "/usr/bin/fish",
    "args": ["-l"],
    "env": { "MY_TOOL": "value" }
  }
  ```
  `command` is a program name or path, `args` a bounded array of strings, `env` a
  bounded string-to-string map. Livecraft does not translate arguments per shell;
  startup scripts are expressed with the shell's own flags (see idiom table). This
  keeps Livecraft dumb: spawn `command` with `args`, env, and the validated workspace
  as `cwd`, exactly like `defaultPtySpawner` does today.
- **Validation shape, not content:** non-empty command, at most 16 args of at most
  1000 chars, at most 32 env entries of bounded length. Values are never passed
  through a shell, so argv-style spawning stays shell-injection-free.
- **Per-workspace history is Livecraft-managed, not configured per shell:** before
  spawn, ensure the directory `<repo root>/terminal-history/` exists (sibling of the
  app log, gitignored) and inject `HISTFILE=<dir>/<sha256(canonical workspace path)
  first 16 hex>.history` into the environment. Livecraft never writes the file; the
  shell owns its format and read/write timing.
- **Windows v1 stays on default behavior.** PowerShell stores history via PSReadLine,
  which env vars cannot retarget; isolation there needs a startup command and is
  explicitly out of scope.
- **No UI.** The file is hand-edited; the status pill already shows the running shell.

## Shell idiom table

How the requested controls map per shell. Livecraft only injects env vars; everything
else is the user's `args`.

| Control         | bash                        | zsh                                | fish                          | pwsh (out of scope v1)            |
| --------------- | --------------------------- | ---------------------------------- | ----------------------------- | --------------------------------- |
| Login/profile   | `["-l"]`                    | `["-l"]`                           | `["-l"]`                      | `["-NoExit", "-Command", "..."]`  |
| Startup script  | `["--rcfile", "<f>", "-i"]` | env `ZDOTDIR=<dir>` (dir holds `.zshrc`) | `["--init-command", "source <f>"]` | `["-NoExit", "-File", "<f>"]` |
| Extra env       | `env` key, inherited        | `env` key, inherited               | `env` key, inherited          | `env` key, inherited              |
| History control | `HISTFILE` env              | `HISTFILE` env (+ `SAVEHIST`; verify import) | `fish_history` env names a file inside fish's data dir — no path control | PSReadLine `-HistorySavePath` needs a command |

- bash honors `HISTFILE` from the environment (reads at start, writes on exit;
  last-writer-wins across concurrent shells in one workspace — acceptable, that is
  exactly "one history per workspace").
- zsh additionally needs `SAVEHIST > 0` for saving; confirm at implementation that an
  exported `SAVEHIST` is imported as the parameter, otherwise document the `args`
  workaround (`["-c", "..."]` wrappers are rejected as a design; prefer env that works).
- fish cannot point `fish_history` at an arbitrary path; a workspace could redirect all
  fish data via `XDG_DATA_HOME`, which is heavier than requested. v1 documents fish
  history as unisolated.

## Implementation sketch

- `server/features/terminal/shell-config.ts` (new, ~60 lines): read, validate, and
  default the config file; pure parse function for tests.
- `server/features/terminal/session.ts` (~30 lines): extend `PtySpawnOptions` with the
  resolved `{ command, args }`; `defaultPtySpawner` uses it with today's fallback;
  `terminalEnvironment()` gains the workspace path and injects `HISTFILE`.
- `server/backend.ts` (~10 lines): mkdir `terminal-history/` beside the app log;
  `.gitignore` entry.
- `test/terminal-session.test.ts` (+ `shell-config` cases): config parsing/fallback,
  spawner receives configured file/args, env carries the per-workspace `HISTFILE`.

Estimated size: ~100 lines plus tests. No manager, Pi RPC, HTTP contract, or frontend
changes.

## Out of scope

- Windows/PowerShell history isolation.
- Per-session (instead of per-workspace) history.
- A settings UI or hot-reload beyond "read at next shell start".
- Editing the shell's rc files or managing their content.
