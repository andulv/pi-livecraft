# Workspace containers

Status: **draft proposal — not implemented**. This captures the workspace-container
and browser discussion, not an approved implementation plan. Goals below establish
the intended direction; alternatives and unresolved choices remain explicit.

## Purpose

Give each workspace (main checkout or linked worktree) its own project-configured
development environment. Agents should build, run, test, and debug there instead of
competing with other workspaces for host processes and ports. Humans should be able
to inspect and interact with that environment through Livecraft.

Browser observation/control is a supporting capability, **not a prerequisite for
shipping workspace containers**. Its implementation must not determine where Pi runs.

## Current implementation

- The manager owns persistent host-side Pi RPC processes. `server/pi-process.ts`
  launches Pi with the workspace as its working directory.
- Browser and embedded-terminal processes belong to the HTTP backend and are lost
  on backend restart; Pi sessions survive that restart.
- The browser backend already groups instances by canonical workspace path and
  browser ID. The viewer uses `main`, and each browser session attaches to one page
  target rather than maintaining a selectable collection of tabs.
- Pi sessions in the same workspace receive the same browser endpoint and
  Playwright CLI session name. This invites accidental concurrent control.
- Agents can use shell commands, automation libraries, and browser executables
  directly. Instructions discourage unmanaged browsers but do not prevent them.

Existing contracts: [architecture](ARCHITECTURE.md),
[manager lifecycle](MANAGER-LIFECYCLE.md), and
[browser feature reference](../src/features/browser/README.md). The older
[browser specification](BROWSER-BRIDGE.md) includes historical decisions; the feature
reference and source describe current behavior.

## Goals and scope

- Project-defined tooling/images, with a separate runtime instance per workspace.
- Workspace-local execution for development commands, file operations, terminals,
  and relevant agent tools, including delegated work.
- Multiple independent browsers per workspace and multiple tabs per browser.
- Agents can create browsers on demand without waiting for human allocation.
- Humans can discover, view, and interact with supported browser instances and
  create/share an instance when useful.
- Keep Pi placement replaceable: host Pi with remote tools and container Pi are both
  valid designs.
- Prefer existing Livecraft boundaries and upstream capabilities over a new
  orchestration platform or browser automation framework.

Prototype priorities are reliability, visibility, and avoiding accidental conflicts,
not adversarial enforcement. Keep the application's loopback-only exposure and avoid
unnecessary host access, but defer strict browser-launch restrictions and hardening.
A container is not automatically a complete security boundary.

**Isolation is per workspace, not per agent session.** Sessions in one workspace
still share files, processes, and ports. Independent concurrent development should
use separate workspaces; same-workspace coordination remains a separate concern.

## Proposed user experience

### Workspace environment

- A workspace displays its execution mode and environment state, such as stopped,
  starting, running, or failed, with actionable logs/errors.
- Users can start, stop, and rebuild the environment. Potentially disruptive actions
  identify affected sessions, apps, terminals, and browsers before confirmation.
- The embedded terminal opens in the workspace environment. Running apps and their
  forwarded addresses are visible from the workspace.
- Different workspaces can use the same internal application port. Host access uses
  separately allocated loopback forwards; no host-network mode by default.
- Container rebuilds preserve workspace files and persisted session history. The
  exact persistence policy for caches, browser profiles, and other state is open.

### Browser surface

The viewer lists browser instances within a workspace, with tabs under each instance.
Humans can select a browser/tab, navigate, and interact with it. Agent-created tabs
and popups should appear without requiring separate registration calls.

Browser names, creator-session attribution, sharing, follow-agent mode, and explicit
control handoff are desirable additions, not prerequisites for discovery. A discovered
browser with unknown ownership is still useful and should not be hidden. Viewing a
tab and an agent's automation target need not be the same; a follow-agent feature
will need an explicit activity/selection signal rather than assuming a universal
active tab across independent automation clients.

Separate instances should normally have separate profiles; tabs within an instance
can share cookies/login state. Profile persistence and cleanup require a defined
policy before implementation. Closing a viewer must not implicitly close the browser.

## Architecture direction

```text
Livecraft frontend
    │ existing API boundary
HTTP backend — routing, validation, event/frame relay
    │
Manager — Pi session lifecycle; candidate host for workspace-runtime modules
    │
Workspace environment — files, commands, terminals, applications, browsers
```

### Separate Pi placement from workspace execution

Use narrow owning interfaces, not a speculative general-purpose plugin system:

- **Pi session runner:** launches Pi locally or inside the environment and exposes
  its public RPC stream to the manager.
- **Workspace execution:** file operations, command execution/cancellation, terminals,
  and resource discovery/lifecycle within the selected environment.
- **Workspace identity and paths:** stable workspace identity plus explicit
  host/container path mapping, shared by both placement choices.

These seams should allow switching placement without redesigning browser UI or the
workspace resource model. They do not promise hot migration of a running Pi process.

| Pi placement | Advantages | Costs and integration work |
| --- | --- | --- |
| Host Pi, container-backed tools | Host configuration, credentials, and session lifetime stay familiar | Route all relevant tools, custom extensions, user shell commands, and delegated sessions deliberately; maintain path mapping |
| Pi inside container | Tools and subprocesses naturally execute in the same environment | Provision Pi/extensions/configuration, expose credentials deliberately, persist history, and handle container/session lifetime coupling |

Pi supports remote tool operations and ships a Gondolin routing example; redirecting
execution is a supported pattern, not merely a Bash workaround [1][2]. Overriding
built-in tools does not automatically redirect arbitrary extension code.

**Decision remains open.** Host Pi with container-backed tools is a reasonable first
spike given configuration/lifetime concerns. Validate custom search tools and subagent
routing as well as built-in read/write/edit/Bash before selecting it.

### Configuration and lifecycle

Prefer `.devcontainer/devcontainer.json` and the Dev Container CLI for project-defined
environments rather than inventing an image format. The CLI supports environment
creation and command execution [3]. Initial supported configuration scope is open;
full Dev Container/Compose compatibility is not implied.

The existing manager is the first candidate for hosting workspace-runtime modules;
a separate daemon is not assumed necessary. Browsers/terminals must move out of
backend ownership if they are to survive backend restarts. This is an explicit
change to current lifecycle contracts, not a browser-route refactor.

Before implementing that move, decide shutdown/recovery behavior for backend restart,
guarded manager restart, manager crash, container stop, and container rebuild. Preserve
the existing guarded manager restart policy unless a change is explicitly approved.
Do not assume manager restart automatically means container destruction.

Other required integration decisions:

- Worktree mount layout, including access to linked worktree Git metadata without
  indiscriminately mounting other workspaces.
- Which Git/file operations remain host-side and which execute inside, with consistent
  paths and file ownership across UI and tools.
- Persistent history/configuration, credentials, caches, and image setup/versioning.
- Cancellation and process-tree cleanup for commands and Pi launched through container
  execution, including manager process reuse across sessions.
- Loopback port forwarding and a relay into container-local CDP endpoints.

## Browser observation and control: alternatives

Browser tooling ultimately launches an executable (Chromium for the current viewer).
It may use Playwright CLI, Playwright scripts/tests, another automation library, or a
direct executable invocation. Discovering a process does **not** guarantee an attachable
endpoint. Ordinary Playwright Chromium launches typically use a private debugging pipe;
Livecraft's existing viewer needs a reachable CDP connection [4].

| Approach | What it provides | Limitations / cost |
| --- | --- | --- |
| Instructions plus direct attachment | Smallest change to the current skill | Agents can forget; does not discover independent launches |
| Playwright CLI discovery/dashboard | `list` discovers CLI sessions; `show` supplies previews, tabs, and interaction [5] | Not a registry of arbitrary browser processes; stable embedding/endpoint access and installed-version support need verification |
| Discover exposed CDP endpoints | Inspect browser processes/listeners or profile endpoint files, validate `/json/version`, enumerate `/json/list` | Covers connectable Chromium instances only; unknown creator; stale/disappearing processes must be tolerated |
| Executable wrapper adding CDP | Agents launch normally; configured browser entry points automatically expose discoverable endpoints | Must cover actual executable paths and preserve launcher behavior; new browser downloads can bypass it |
| Livecraft creation tool / CLI broker | Create/list/release with reliable attribution and registration; can reuse upstream automation after attachment | Adds a managed creation path; unrestricted shell/scripts can bypass it |
| Restricted automation gateway | Can mediate access/control through the gateway | Preventing independent launches also needs execution restrictions; out of prototype scope |

### Promising prototype: executable wrapper plus discovery

Configure the supplied Chromium launch paths to use a wrapper that:

1. Adds `--remote-debugging-port=0` when no debugging port was supplied.
2. Preserves caller arguments and profile; supplies a separate non-default profile
   when needed, with an explicit cleanup policy.
3. Uses `exec` and preserves file descriptors/signals, including Playwright's pipe.

Chromium can start its pipe handler and TCP debugging server independently [6]. With
port `0`, it allocates an available port and writes connection information to the
profile's `DevToolsActivePort` file [7]. This makes simultaneous agent automation and
Livecraft attachment plausible, **not yet tested with our selected image/versions**.

A `chromium` wrapper on `PATH` alone is insufficient: Playwright can invoke downloaded
binaries by absolute path. Image construction must configure tools to use the wrapper
or wrap the supplied browser entry points. Account for headless-shell variants and
browser updates; do not promise interception of arbitrary newly installed browsers.
Do not blindly append duplicate port/profile switches or modify renderer subprocess
launches.

Livecraft can discover candidates inside the container, validate live CDP endpoints,
and relay the selected instance. Use browser-level target discovery for tab
creation/change/destruction [8]. Probe on refresh or poll while the browser surface is
open; registration, creator attribution, and fixed port allocation are not required.
Discovery must discard stale endpoints and not identify a browser solely by a reused
port. Container-local loopback endpoints need a relay, not just a host-visible URL.

The prototype may therefore promise **visibility of supported, CDP-enabled browsers**,
not visibility of every arbitrary browser process. A broker remains an option if
wrapper/discovery compatibility proves too fragile. Tokens could gate a future relay,
but do not make independent browser launches impossible.

## Staged validation and decisions

1. **Workspace execution spike:** one worktree/environment; commands, file tools,
   terminal, and delegated work execute there. Demonstrate two workspaces running
   applications on the same internal port without cross-workspace interference.
2. **Pi placement comparison:** exercise configuration/credentials, history/resume,
   cancellation, path mapping, and custom tools. Choose one runner while retaining
   the narrow seam for the alternative.
3. **Lifecycle contract:** specify persistence and behavior for each restart/stop
   event, then validate reconnect/recovery. Use the focused manager lifecycle tests
   named in `MANAGER-LIFECYCLE.md` when changing that boundary.
4. **Independent browser spike:** compare upstream CLI discovery/dashboard with
   wrapper plus CDP discovery. Test direct Chromium, Playwright CLI, and a Playwright
   script; simultaneous instances; tabs/popups; concurrent automation and viewing;
   process exit; and backend reconnection. Existing `test/browser-smoke.test.ts` is a
   starting point, not proof of the new container contract.
5. **Incremental UX:** workspace state/terminal/apps first; browser instance/tab
   selection next; naming, sharing, and control handoff when useful.

No runtime changes, dependencies, container launches, or manager restarts are authorized
by this draft. Browser observability can progress independently of the execution core.

## Sources

Upstream documentation/source inspected during design; capabilities must be verified
against the versions selected for the implementation.

1. [Pi extensions: remote execution](https://pi.dev/docs/latest/extensions)
2. [Gondolin Pi routing example](https://github.com/earendil-works/gondolin/blob/main/host/examples/pi-gondolin.ts)
3. [Dev Container CLI](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli)
4. [Playwright Chromium launcher](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromium.ts)
5. [Playwright CLI](https://github.com/microsoft/playwright-cli)
6. [Chromium remote debugging server](https://github.com/chromium/chromium/blob/main/chrome/browser/devtools/remote_debugging_server.cc)
7. [CDP endpoint discovery](https://chromedevtools.github.io/devtools-protocol/)
8. [CDP Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/)
