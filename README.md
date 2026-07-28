<div align="center">

# Pi Livecraft

**Craft your own Pi client while it runs.**

Use your Pi sessions in a browser, with a more visual and interactive interface you can shape around the way you work.

[![Built with Pi](https://img.shields.io/badge/Built%20with-Pi.dev-6C63FF?style=flat-square&logo=terminal&logoColor=white)](https://pi.dev)
[![Version](https://img.shields.io/github/package-json/v/sebastienservouze/pi-livecraft?style=flat-square&label=version)](package.json)
[![License](https://img.shields.io/github/license/sebastienservouze/pi-livecraft?style=flat-square)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/sebastienservouze/pi-livecraft?style=flat-square&logo=github)](https://github.com/sebastienservouze/pi-livecraft/stargazers)
[![Use this template](https://img.shields.io/badge/Use_this_template-2ea44f?style=flat-square&logo=github)](https://github.com/new?template_name=pi-livecraft&template_owner=sebastienservouze)

[Why Pi Livecraft?](#why-pi-livecraft) · [Quick start](#quick-start) · [Make it yours](#make-it-yours) · [Docs](/docs/README.md)

</div>

<p align="center"><img src="./docs/assets/demo-pi-livecraft.gif" alt="Editing Pi Livecraft from a live Pi session" width="1200" /></p>
<p align="center"><sub>Asking Pi to add a confetti celebration to the client from the session running inside it.</sub></p>

## Why Pi Livecraft?

Pi Livecraft connects a Pi conversation to a React application. That opens up interactions that are awkward in the usual terminal flow: analyze a session in charts and click a turn to jump back into the conversation, replay a command from its Bash tool call, or open a referenced file directly in Explorer.

The analysis and jump-back navigation are included today. The Bash and file actions are examples of the small, personal additions Livecraft is made for. Ask Pi to change the client from the session already running inside it, then try most client changes without closing the Pi process. The agent-oriented docs point Pi to the right code and focused checks, making this loop practical.

## Quick start

Pi Livecraft is designed to run in development mode. You need **Node.js 24 or newer**, **npm**, and **Pi**. The target environments are Linux with a graphical desktop and WSL; native Windows is not a supported target.

### 1. Install Pi

Pi is required: Pi Livecraft provides the interface, but it does not bundle the agent. Install the [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) package, then launch Pi once to configure a provider:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
```

Use `/login` inside Pi, or follow the [Pi quickstart guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md) for API keys and alternative authentication modes. If `pi --version` already works and a provider is configured, you are ready.

### 2. Create your repository

Click **[Use this template](https://github.com/new?template_name=pi-livecraft&template_owner=sebastienservouze)**, choose a name and visibility, then clone the repository GitHub creates for you. Unlike a fork, your repository starts with its own history and is yours to reshape.

### 3. Install and run

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
npm install
npm run dev
```

`npm run dev` watches the frontend and backend while a stable supervisor keeps the manager running. Manager runtime changes are reported in the interface and take effect only after you choose **Restart manager**; `Ctrl+C` stops all three processes.

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

On Linux, opening a folder or terminal uses the desktop tools available in your environment (`xdg-open` and `x-terminal-emulator`). Under WSL, Pi Livecraft uses Windows Explorer and Windows Terminal; leave the terminal setting empty to use that platform default, or configure a command containing `{cwd}`.

> [!WARNING]
> **Pi is not sandboxed.** It runs with your user permissions and can read files, modify code, and execute commands. Keep important work under version control and review Git actions before confirming them. Pi Livecraft limits network exposure by listening only on `127.0.0.1`.

## What is already included

- **Session workspace:** create, switch, and reopen parallel Pi sessions across multiple workspaces, with active and newly completed sessions surfaced in the sidebar so you can monitor ongoing work and jump wherever attention is needed.
- **Live execution:** inspect responses, activity, usage, rich tool calls, file previews, and extension dialogs as they happen.
- **Session analysis:** track context, tokens, costs per turn, tool activity, and failures, then jump back to the relevant message or call.
- **Provider quotas:** monitor OpenAI Codex windows and GitHub Copilot usage from the right rail.
- **Git workspace:** review status, diffs, touched files, and unpushed commits; commit, push, or revert without changing context.
- **Focused side tools:** keep todos and bounded workspace commands one click away.
- **Pi-native controls:** use the models, thinking levels, and commands exposed by Pi.
- **Personal controls:** command palette, editable shortcuts, persistent drafts, resizable panels, and light or dark themes.

## Recommended extensions

- **[pi-agents](https://github.com/sebastienservouze/pi-agents):** adds specialized agents with focused prompts, restricted tool sets, and isolated delegation. When available in Pi, its agent selector is automatically exposed in the Livecraft composer.
- **[pi-auto-title](https://github.com/sebastienservouze/pi-auto-title):** automatically names sessions from their first prompt, making parallel workspace histories easier to scan.

## Make it yours

Pi Livecraft is a playground for improving your own Pi workflow. Start with a small friction: something you type repeatedly, context you keep looking up, or output you wish were easier to scan. Ask Pi to turn it into part of the application, review the diff, and try it for a while. Keep what helps and gleefully remove the rest.

A few ideas:

- turn a repeated prompt or workspace command into a one-click action;
- give an important tool call a richer, more useful presentation;
- surface the session context you usually hunt for in a right-rail widget;
- combine messages, forms, and actions into a workflow for a recurring task;
- strip the interface back to the features you enjoy using.

There is no canonical setup and no prize for keeping every feature. Make something useful, make something weird, and have fun. The focused guides in the [documentation index](/docs/README.md) and [frontend feature map](/src/features/README.md) point to the smallest owning area for each experiment.

## How Pi Livecraft talks to Pi

Pi remains the agent harness: it owns the session, model, tools, history, and extensions. Pi Livecraft does not replace that runtime; it adds a React interface on top of it.

A local backend sends commands to `pi --mode rpc` through Pi's public RPC protocol, then streams Pi's events back to the browser:

```text
React browser
    │ HTTP + SSE
    ▼
server/backend.ts ─── local JSON Lines ──▶ server/manager.ts ─── Pi public RPC ──▶ pi --mode rpc
                                               ▲
                                               │ guarded lifecycle
                                    server/manager-supervisor.ts
```

The manager remains the sole owner of Pi processes, so browser and backend restarts preserve sessions. The supervisor records the manager runtime revision at launch but never restarts it after a code change or crash. Runtime changes produce a notice; replacement occurs only after the manager accepts a guarded restart and exits cleanly.

| Change | Development behavior | Active session |
| --- | --- | --- |
| React UI and feature styles | Vite hot update | Preserved |
| Backend routes and capabilities | `node --watch` restart | Preserved |
| Declared manager runtime files | Persistent notice, then guarded restart | Blocked during active work; Pi processes close, but sessions remain in history |

Read [`docs/ARCHITECTURE.md`](/docs/ARCHITECTURE.md) before changing boundaries, and [`docs/MANAGER-LIFECYCLE.md`](/docs/MANAGER-LIFECYCLE.md) before changing manager supervision or restart behavior.

## Project map

```text
src/features/        Frontend behavior, rendering, and colocated styles
src/api.ts           Browser-to-backend boundary
server/backend.ts              Local HTTP API and SSE stream
server/manager-supervisor.ts   Stable, explicit manager restart boundary
server/manager.ts              Sole owner of Pi RPC processes
server/features/               Git, quotas, terminal, and todo capabilities
pi-extensions/       Extensions loaded ONLY into Livecraft sessions
shared/              Contracts exchanged between layers
test/                Focused automated checks
```

## Checks

Run the narrowest check that covers your change, or the full local set before a larger contribution:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The Pi RPC integration test additionally requires a configured Pi installation.

## Troubleshooting

- `pi: command not found`: install Pi globally and verify that `pi --version` works in the same shell used to start Livecraft.
- The manager or backend is unavailable: check that ports `43120` and `43121` are free, or set `PI_LIVECRAFT_MANAGER_PORT` and `PI_LIVECRAFT_BACKEND_PORT`. After a manager crash, restart `npm run dev`; the supervisor intentionally does not relaunch it automatically.
- A new session cannot answer: launch Pi once, configure a provider with `/login`, and verify the `/agent` extension is available.
- Linux desktop actions unavailable: install or expose `xdg-open` and `x-terminal-emulator` in `PATH`.
- WSL desktop actions unavailable: verify that `explorer.exe`, `wslpath`, and `wt.exe` are available in the WSL `PATH`.

## Built with Pi, for Pi ❤️

Pi Livecraft is made specifically for the [Pi coding agent](https://pi.dev). It embraces Pi's extension system, live development workflow, and agent architecture instead of replacing or abstracting them away.

## Contributing

Applications built from the template belong in their own repositories and do not need to stay synchronized with Pi Livecraft. Focused bug fixes and improvements to the reusable starting point are welcome here.

## License

Pi Livecraft is available under the [MIT License](/LICENSE).
