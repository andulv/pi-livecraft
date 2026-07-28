# Change prompt improvement

Prompt improvement rewrites a composer draft in a disposable Pi process. It never adds the source
or suggestion to the active session, and the user must explicitly accept the result.

## Flow

```text
Composer.tsx: onImprovePrompt(draft, direction)
    → App.tsx
    → src/api.ts: improvePrompt()
    → POST /api/sessions/:id/prompt-improvement
    → server/backend.ts
    → server/manager.ts: improvePrompt()
    → server/run-isolated-prompt.ts
    → disposable pi --mode rpc process
```

`Composer.tsx` owns the selected preset, busy state, source/suggestion comparison, cost display,
and accept or dismiss action. `App.tsx` only binds the selected session to `src/api.ts`.

## Context and isolation contract

The manager requires an active, non-exited session to obtain its working directory. It then:

1. loads `server/prompt-improvement-system.txt` fresh for every request;
2. maps a recognized preset in `server/prompt-improvement.ts` to an instruction;
3. generates a depth- and size-bounded project map without reading file contents;
4. wraps the draft in `<user_prompt>` and runs `runIsolatedPrompt()`;
5. disables automatic context files and provides the system prompt and project map explicitly;
6. returns only the rewritten text and optional cost.

The isolated process has no session persistence, extensions, tools, skills, prompt templates, or
themes. Preserve those defaults unless the product contract intentionally changes. Never include
instruction files, hidden entries, dependency trees, build output, virtual environments, or secrets
in the generated project map.

## Change a preset

Keep the UI option in `src/features/composer/Composer.tsx` and its instruction in
`improvementDirections` in `server/prompt-improvement.ts` aligned. Unknown preset values currently
fall back to the base improvement prompt rather than becoming arbitrary instructions.

## Change the system prompt or project map

- Edit `server/prompt-improvement-system.txt` for rewrite behavior; it is loaded fresh and is not a
  manager runtime import.
- Edit `server/prompt-improvement.ts` for map limits, exclusions, preset instructions, model
  selection, or response extraction.
- Keep `server/manager-runtime-files.json` aligned if runtime imports change. Do not restart the
  manager yourself; follow the [manager lifecycle](/docs/MANAGER-LIFECYCLE.md).
- Reuse [isolated prompt execution](/docs/HOW-TO-RUN-ISOLATED-PROMPT.md) rather than spawning Pi in
  another module.

## Validation

Run the narrowest tests for changed pure logic, then the repository checks relevant to the files:

```bash
npm run typecheck
npm run lint
```

If project-map, model-selection, or response-extraction behavior changes, add focused coverage for
`server/prompt-improvement.ts` rather than testing through the visual comparison UI.
