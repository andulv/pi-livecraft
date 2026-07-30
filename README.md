<div align="center">

# Pi Livecraft

**A local web workbench for Pi.**

The repository is set up to be forked and changed while you use it.

[![Built with Pi](https://img.shields.io/badge/Built%20with-Pi.dev-6C63FF?style=flat-square&logo=terminal&logoColor=white)](https://pi.dev)
[![Fork this repo](https://img.shields.io/badge/Fork_this_repo-2ea44f?style=flat-square&logo=github)](https://github.com/sebastienservouze/pi-livecraft/fork)
[![License](https://img.shields.io/github/license/sebastienservouze/pi-livecraft?style=flat-square)](LICENSE)

[Why Livecraft?](#why-livecraft) · [Quick start](#quick-start) · [What is included](#what-is-already-in-the-box) · [Make it yours](#make-it-yours) · [Docs](/docs/README.md)

</div>

<p align="center"><img src="./docs/assets/demo-pi-livecraft.gif" alt="Pi reshaping the Livecraft interface from a live session" width="1200" /></p>
<p align="center"><sub>The demo shows Pi changing Livecraft from an open Livecraft session.</sub></p>

## Pi still does the work

Pi owns the providers, models, sessions, history, tools, commands, and extensions. It reasons, writes code, and runs tools.

Livecraft displays those sessions in a browser and adds local UI around them: panels, previews, buttons, themes, shortcuts, and drafts.

You configure Pi as usual. Livecraft uses what Pi exposes instead of keeping a second provider or model configuration.

## Why Livecraft?

Pi already works well in a terminal. A browser is handy for the parts that benefit from space: comparing token usage between turns, keeping an eye on several sessions, reading a large diff, answering a structured question, or jumping from a chart back to the tool call behind it.

Because the UI lives in this repository, Pi can change it while you use it. When something in the interface is annoying, the usual loop is:

1. Ask Pi to change it.
2. Review the diff.
3. Try the result in the same session.

Most frontend changes appear without interrupting the active conversation. Backend and process-management changes follow the stricter lifecycle described below.

If Pi is making the change, point it at the [documentation index](/docs/README.md). The guides identify the code that owns each behavior and the focused check to run.

## Quick start

You need **Node.js 24+**, **npm**, and a configured **Pi**. Linux and WSL are supported.

**[Fork the repository](https://github.com/sebastienservouze/pi-livecraft/fork)**, then run:

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) and you should see Livecraft.

> [!WARNING]
> **Pi is not sandboxed.** It runs with your user permissions and can read files, modify code, and execute commands. Keep important work under version control and review Git actions before confirming them. Livecraft limits network exposure by listening only on `127.0.0.1`.

## What is already in the box

### Work with Pi

- **Workspaces and parallel sessions:** create, switch, reopen, and monitor Pi sessions across several directories. Running and newly completed sessions remain visible in the list.
- **A Pi-native composer:** send text and images, use slash commands, stop a request, choose the models and thinking levels exposed by Pi, and steer or queue follow-ups while Pi is working.
- **Per-session drafts:** unfinished prompts survive session switches and failed sends.
- **Isolated prompts:** run a one-off Pi prompt from a widget, command, or UI action. By default it uses the cheapest available model, returns one answer, and does not add anything to the active conversation. The prompt rewriter uses this path.
- **Extension dialogs:** handle Pi's standard select, confirm, input, and editor requests, plus structured questionnaires from Livecraft extensions.
- **Optional agent picker:** when Pi exposes the `/agent` command, Livecraft can show the available agents. Their configuration still belongs to Pi.

### See what Pi is doing

- **Live conversations:** responses, activity, tool execution, usage, costs, and errors update as Pi emits them.
- **Readable tool calls:** inspect inputs and outputs, including edit diffs and previews for code and text files. HTML, SVG, and Markdown can render directly, with the source still available.
- **Conversation actions:** copy message text or the input and output of a tool call without opening another panel.
- **Session analysis:** inspect context, tokens, cost per turn, model activity, tool activity, and failures, then jump back to the relevant message or call.

### Keep workspace tools nearby

- **Git:** review status, diffs, changed files, and unpushed commits; commit, push, reset, or revert without leaving the conversation.
- **Provider quotas:** see OpenAI Codex and GitHub Copilot usage windows in one panel.
- **Todos:** keep an ordered task list for each workspace and start a Pi session from a task.
- **Terminal:** open an external Linux or WSL terminal in the current workspace from the rail, palette, or a shortcut.
- **Session analysis:** open the session's requests, models, tools, costs, and failures beside the conversation.

### Shape the workbench

- **Editable color themes:** start from Light or Dark, duplicate and rename a palette, then edit its eight source colors. Livecraft derives the rest of the palette and stores custom themes in the browser.
- **Command palette and editable shortcuts:** commands share one registry. Sidebar widgets get their commands automatically.
- **Local preferences:** conversation display, workspace restoration, shortcuts, terminal command, panel sizes, and widget state stay in the browser.
- **Flexible layout:** resize or collapse the side panels.
- **Notifications:** routine notices disappear on their own; errors remain until dismissed.

## Make it yours

This repository is a starting point. Forks are expected to drift away from upstream, and there is no requirement to keep them synchronized.

Use it for a while. When something gets in the way, ask Pi to change it and keep the result if it helps.

Some reasonable first changes:

- turn a repeated prompt or workspace command into a one-click action;
- give an important Pi tool a presentation that matches its output;
- add a right-rail widget for context you repeatedly hunt down;
- combine messages, forms, and actions into a recurring workflow;
- remove every feature you do not use;
- add something objectively unnecessary but personally delightful.

Upstream stays conservative and mostly takes bug fixes. New workflows and product choices can live in the forks that need them.

## Where to start changing things

The list above shows what exists. The guides below show where a change belongs and which focused check covers it.

| You want to... | Start here |
| --- | --- |
| Change the composer | [Composer guide](/docs/HOW-TO-COMPOSER.md) |
| Add an action to a message or tool call | [Conversation action guide](/docs/HOW-TO-CONVERSATION-ACTION.md) |
| Give a Pi tool a custom presentation | [Tool presentation guide](/docs/HOW-TO-TOOL-PRESENTATION.md) |
| Add a palette command or shortcut | [Palette command guide](/docs/HOW-TO-PALETTE-COMMAND.md) |
| Add a setting or theme | [Settings guide](/docs/HOW-TO-SETTINGS.md) and [theme guide](/docs/HOW-TO-THEME.md) |
| Add a sidebar widget | [Widget guide](/docs/HOW-TO-WIDGET.md) and [widget contracts](/src/features/right-sidebar/README.md) |
| Present UI from a Pi extension | [Dialog contract](/src/features/dialogs/README.md) and [Pi extensions](/pi-extensions/README.md) |
| Send another command to Pi | [Pi RPC guide](/docs/HOW-TO-TALK-TO-PI.md) |
| Run a prompt without touching the session | [Isolated prompt guide](/docs/HOW-TO-RUN-ISOLATED-PROMPT.md) |
| Understand how the browser, local services, and Pi connect | [Architecture guide](/docs/ARCHITECTURE.md) |

The [documentation index](/docs/README.md) links the feature contracts, backend capabilities, widgets, and focused checks behind each surface.

## Under the hood, briefly

Everything runs locally.

The browser renders the application. A local backend handles Livecraft features and carries Pi's events back to the page.

A separate manager starts and owns the Pi processes, so refreshing the browser or restarting the backend does not close them.

The supervisor replaces the manager only after you request a guarded restart and the manager accepts it.

```mermaid
flowchart LR
    subgraph Livecraft["Pi Livecraft"]
        direction LR
        Browser(["React browser"])
        Backend["Local backend"]
        Manager["Pi process manager"]
        Supervisor["Manager supervisor"]

        Browser <-->|"HTTP + SSE"| Backend
        Backend <-->|"Local JSON Lines"| Manager
        Supervisor -.->|"guarded lifecycle"| Manager
    end

    Manager <-->|"Pi public RPC"| Pi(["Pi<br/><code>pi --mode rpc</code>"])
```

Vite can update the frontend while a session stays open. The backend can also restart without closing active Pi processes.

If manager code changes, Livecraft shows a persistent notice and waits. The manager is not replaced until you ask and Pi is idle. Sessions closed during the replacement remain available in history.

The manager talks to Pi through its public RPC protocol. Livecraft extensions use Pi's public extension API.

Git, todos, terminal launching, and browser preferences remain local Livecraft features.

Read the [architecture guide](/docs/ARCHITECTURE.md) for the full flow. Read the [manager lifecycle guide](/docs/MANAGER-LIFECYCLE.md) before touching process supervision.

## Optional Pi extras

These extensions are installed and configured in Pi. Livecraft adds UI for them when Pi exposes their commands or results.

- **[@nerisma/pi-agents](https://github.com/sebastienservouze/pi-agents):** adds specialized agents with focused prompts, restricted tool sets, and isolated delegation. When Pi exposes `/agent`, Livecraft displays an agent picker.
- **[@nerisma/pi-auto-title](https://github.com/sebastienservouze/pi-auto-title):** names sessions from their first prompt, which makes parallel histories much easier to scan.

<details>
<summary><strong>Troubleshooting</strong></summary>

- `pi: command not found`: install Pi globally and verify that `pi --version` works in the shell used to start Livecraft.
- The manager or backend is unavailable: check ports `43120` and `43121`, or set `PI_LIVECRAFT_MANAGER_PORT` and `PI_LIVECRAFT_BACKEND_PORT`. After a manager crash, restart `npm run dev`; the supervisor intentionally does not relaunch it automatically.
- A new session cannot answer: launch Pi once, configure a provider with `/login`, and verify that the `/agent` extension is available if your setup expects it.
- Linux desktop actions unavailable: install or expose `xdg-open` and `x-terminal-emulator` in `PATH`.
- WSL desktop actions unavailable: verify that `explorer.exe`, `wslpath`, and `wt.exe` are available in the WSL `PATH`.

</details>

<details>
<summary><strong>Development checks</strong></summary>

Run the narrowest check that covers your change. For a larger change, the full local set is:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The Pi RPC integration test additionally requires a configured Pi installation.

</details>

## Built with Pi, for Pi ❤️

Pi provides the agent runtime, sessions, tools, and extension model. It does the actual work; Livecraft is a local web interface built around it.

## Contributing

Focused bug reports and bug fixes are welcome upstream. Workflow features belong in the forks that need them, with no obligation to send them back or keep them synchronized.

## License

Pi Livecraft is available under the [MIT License](/LICENSE).
