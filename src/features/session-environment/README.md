# Session environment widget

The environment widget answers the question the Pi terminal answers at startup: what does this session have loaded? Livecraft can show more than the terminal, so each entry carries its description, source, and location.

## What it shows

- **Context** — the selected session's model and thinking level, context-window usage with the same pressure thresholds as the composer, and the context files Pi loaded into the system prompt (path and byte size; contents never cross the boundary);
- **Tools** — every configured tool with its description, source (built-in, extension, or sdk), and active state; rows with parameter schemas expand on click, and a filter box narrows the list by name or description;
- **Skills** — loaded skills with description, user/project scope, and SKILL.md path;
- **Extensions & prompts** — extension files grouped by path with their registered commands and a count of tools they register, plus prompt templates with their invocation name.

Tools and context files arrive through the versioned `pi-livecraft.environment` status payload published by the [session-environment extension](/pi-extensions/README.md). Skills, prompt templates, and extension commands come from the snapshot's `get_commands` data, so those sections work even before the first environment reading lands.

## Ownership and data flow

`App.tsx` owns the shared environment snapshot. `SessionEnvironmentWidget` renders it together with the selected session's snapshot (commands, stats, state).

Requests travel through `src/api.ts` and the [session-environment backend capability](/server/features/session-environment/README.md). The backend restores its cache from an idle session on manager reconnect, so readings normally arrive without a manual refresh.

Focused coverage: `test/session-environment.test.ts`.
