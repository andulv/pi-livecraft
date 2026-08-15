# Session environment widget

The environment widget answers the question the Pi terminal answers at startup: what does this session have loaded? Livecraft can show more than the terminal, so each entry carries its description, source, and location.

## What it shows

- **Context** — the selected session's model and thinking level, context-window usage with the same pressure thresholds as the composer, and the context files Pi loaded into the system prompt (path and byte size; contents never cross the boundary);
- **Tools** — every configured tool grouped by source (built-in, extension, or sdk), with its description and active state; the section and source groups expand independently, extension groups show their source path, rows with parameter schemas expand on click, and a filter box narrows the list by name or description. Counts label configured tools as available, not loaded into context. The widget also shows a clearly labelled estimate of each active tool's prompt footprint from its name, description, and parameter schema; it uses a four-characters-per-token heuristic rather than a model-specific token count;
- **Skills** — available skills grouped by Pi provenance (scope or source package), with each SKILL.md path and description. The section and source groups expand independently. The footprint is the measured entry — the name and description Pi places in the system prompt for each available skill; skill file contents load only on invocation and never cross the boundary. Token counts use the same four-characters-per-token heuristic as tools;
- **Extensions & prompts** — extension files grouped by path with their registered commands and a count of tools they register, plus prompt templates with their invocation name.

Tools and context files arrive through the versioned `pi-livecraft.environment` status payload published by the [session-environment extension](/pi-extensions/README.md). Skills, prompt templates, and extension commands come from the snapshot's `get_commands` data, so those sections work even before the first environment reading lands.

## Ownership and data flow

`App.tsx` owns the shared environment snapshot. `SessionEnvironmentWidget` renders it together with the selected session's snapshot (commands, stats, state).

Requests travel through `src/api.ts` and the [session-environment backend capability](/server/features/session-environment/README.md). The backend restores its cache from an idle session on manager reconnect, so readings normally arrive without a manual refresh.

Focused coverage: `test/session-environment.test.ts`.
