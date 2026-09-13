# Shub agents

`index.ts` registers one `subagent_<name>` Pi tool for each bundled definition in
`agents/index.ts`. A definition owns its caller arguments, prompt, tools, model,
effort levels, and default report size. The extension shares child-process
isolation, tool-budget enforcement, progress, persistence, and result shaping.

Each call starts one `pi --mode json --print` child in the parent's workspace.
Global and project extensions, skills, prompt templates, themes, and context
files are disabled. The child receives only its definition's tools plus the
internal budget and ownership-marker extensions. Definitions may declare extra
extension entries and toolchain flags via `extensions`, `providerArgs`, and
`providerEnv`. Declaring `bash` grants full Bash access; there is no sandbox yet.

The caller may select a declared effort level and `max_chars` from 1 to 100,000.
Effort controls the hard process timeout and soft/hard tool-call counts;
`max_chars` independently controls the report returned to the parent. The child
is told both values. Progress updates stay in tool UI state rather than parent
conversation context.

Runs persist as ordinary Pi session files with a `livecraft.shub-agent` ownership
entry. The server uses that marker to hide child sessions by default and group
them under their owner when requested. The tool result includes the child
session path when it can be resolved.

Add an agent by creating one TypeScript module with `defineSubagent(...)` and
adding it to `agents/index.ts`. Keep parent-visible descriptions, parameter
help, snippets, and guidelines concise. The v2 design history is in
[`plans/proposals/subagents-v2.md`](../../plans/proposals/subagents-v2.md).

Focused checks:

```bash
npm test -- test/shub-agent-runner.test.ts test/shub-agent-session.test.ts test/subagent-definition.test.ts test/sidebar-sessions.test.ts
npm run typecheck
npm run lint
```
