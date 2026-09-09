# Documentation

Pi Livecraft is documented in layers: begin with the system you want to build on, then follow a deeper link only when the change crosses a boundary. Implementation guides describe the project's supported composition points; feature README files record their local contracts.

- **[Andulv fork feature overview](/docs/ANDULV-FORK-FEATURES.md)** — additions and improvements made by `andulv/pi-livecraft`, with screenshots from the running fork.
- **[Browser bridge specification](/docs/BROWSER-BRIDGE.md)** — CDP livecast browser for the viewer pane; the spec records the design and is now implemented.
- **[Embedded terminal specification](/docs/EMBEDDED-TERMINAL.md)** — server-side PTY shell in a viewer-pane Terminal tab; the spec records the transport decision and is now implemented.
- **[Project trust UI specification](/docs/PROJECT-TRUST.md)** — proposed workspace trust indicator and exact-workspace trust controls backed by Pi's native trust model.
- **[Session data performance spec](/docs/SESSION-PERFORMANCE-SPEC.md)** — measured findings and a task plan for snapshot cost, workspace switching, right-panel persistence, and session data reading. Not yet implemented; a specification and task plan, not a guide.
- **[Subagent sessions specification](/docs/SUBAGENT-SPEC.md)** — one research-assistant subagent tool with effort budgets, live progress in the tool card, and persisted child sessions openable in the ordinary session view. Not yet implemented; a specification and task plan, not a guide.

## Find the right place

- **Understand or reshape the system:** [project architecture](/docs/ARCHITECTURE.md).
- **Change the frontend:** [frontend feature map](/src/features/README.md).
- **Add a tooltip or shared UI element:** [shared components](/src/components/README.md).
- **Modify the composer:** [step-by-step guide](/docs/HOW-TO-COMPOSER.md), then [composer reference](/src/features/composer/README.md).
- **Add a command, palette entry, or shortcut:** [step-by-step guide](/docs/HOW-TO-PALETTE-COMMAND.md), then [contract reference](/src/features/commands/README.md).
- **Add a preference, persisted UI state, or settings tab:** [how to settings](/docs/HOW-TO-SETTINGS.md), then [settings and preferences](/src/features/settings/README.md).
- **Customise colours or add a theme:** [how to theme](/docs/HOW-TO-THEME.md).
- **Verify a visual or pane change in the running app:** load the [livecraft-browser skill](/pi-skills/livecraft-browser/SKILL.md) and attach to the workspace's shared browser — the one rendered in the viewer pane; never launch your own. Use it for what unit tests cannot see: rendering, themes, tabs, focus, and SSE-driven surfaces.
- **Add a right sidebar widget:** [step-by-step guide](/docs/HOW-TO-WIDGET.md), then [contract reference](/src/features/right-sidebar/README.md).
- **Add an action to a message or tool call:** [step-by-step guide](/docs/HOW-TO-CONVERSATION-ACTION.md), then [conversation contract](/src/features/conversation/README.md).
- **Change a tool call display:** [step-by-step guide](/docs/HOW-TO-TOOL-PRESENTATION.md), then [conversation contract](/src/features/conversation/README.md).
- **Change extension dialogs or questionnaires:** [dialog protocol](/src/features/dialogs/README.md), then [Pi extensions](/pi-extensions/README.md).
- **Change transient notices or errors:** [notifications](/src/features/notifications/README.md).
- **Change Git, quotas, or terminal on the server:** [backend capabilities](/server/features/README.md).
- **Change manager runtime, supervision, or restart behavior:** [manager lifecycle](/docs/MANAGER-LIFECYCLE.md).
- **Send a command to a Pi session or inspect its data:** [how to talk to Pi](/docs/HOW-TO-TALK-TO-PI.md), which explains how to locate the upstream RPC reference installed with Pi.
- **Run an isolated one-shot prompt without touching the session:** [how to run an isolated prompt](/docs/HOW-TO-RUN-ISOLATED-PROMPT.md).
- **Change code loaded into Pi:** [Pi extensions](/pi-extensions/README.md).

## Implementation guides

Step-by-step walkthroughs for common tasks. Each guide is self-contained: start here, follow the file references, no prior knowledge assumed.

- **[Modify the composer](/docs/HOW-TO-COMPOSER.md)** — add a toolbar button, dropdown, or session stat.
- **[Add a widget](/docs/HOW-TO-WIDGET.md)** — sidebar widget, API endpoint, and backend capability.
- **[Add a conversation action](/docs/HOW-TO-CONVERSATION-ACTION.md)** — contextual action on a message or tool call.
- **[Add a tool call presentation](/docs/HOW-TO-TOOL-PRESENTATION.md)** — custom display for a Pi tool in the conversation.
- **[Add a palette command](/docs/HOW-TO-PALETTE-COMMAND.md)** — palette entry, keyboard shortcut, and execution.
- **[Add or modify a settings tab](/docs/HOW-TO-SETTINGS.md)** — new tab, section component, and persistence.
- **[Talk to Pi](/docs/HOW-TO-TALK-TO-PI.md)** — send arbitrary RPC commands and understand the data Pi returns.
- **[Run an isolated prompt](/docs/HOW-TO-RUN-ISOLATED-PROMPT.md)** — execute a one-shot prompt in a disposable Pi process.

Feature README files describe ownership, important constraints, and focused tests. Source files and shared TypeScript types remain authoritative for implementation details.
