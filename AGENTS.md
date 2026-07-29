# Agent instructions

## First: find your guide

Before any exploration, open [`docs/README.md`](/docs/README.md) and pick the guide or feature README closest to your goal. Read that guide, then explore only the code it points to. Skip this step only when the task already names the exact files or symbols to change and no applicable guide exists.

- Read [`docs/ARCHITECTURE.md`](/docs/ARCHITECTURE.md) when a change crosses the frontend, HTTP API, manager, or Pi process boundaries.
- Read [`docs/MANAGER-LIFECYCLE.md`](/docs/MANAGER-LIFECYCLE.md) before any change to the manager runtime, supervision, or restart behaviour.

## Architecture and boundaries

- The React frontend communicates with the backend only through `src/api.ts`.
- `src/App.tsx` orchestrates cross-cutting state. Area-specific rendering and logic belong in `src/features/<feature>/`.
- Colocate feature CSS. Reserve `src/styles/` for global and responsive rules; `src/App.css` remains the ordered entry point.
- `server/backend.ts` owns the web API and SSE stream and can restart without interrupting Pi.
- `server/manager.ts` is the sole owner of `pi --mode rpc` processes; never move that ownership into the backend.
- Manager runtime files are declared in `server/manager-runtime-files.json`; keep it aligned with runtime imports. Edits are detected without interrupting Pi and take effect only after the user requests the guarded restart. Read [`docs/MANAGER-LIFECYCLE.md`](/docs/MANAGER-LIFECYCLE.md); do not restart the manager or supervisor yourself, bypass that flow, or change its lifecycle contract without explicit approval.
- Use Pi's public RPC protocol. Do not read internal files to reproduce an RPC capability.
- The application listens only on `127.0.0.1`. Do not broaden exposure without explicit authentication and scoping.
- Do not add a database, frontend router, state manager, or UI library without demonstrated need.

## Working rules

Pi Livecraft is designed to be modified by the agents using it. Trace the existing flow and callers, then make the smallest compatible change at the owning boundary.

- Reuse repository patterns and preserve observable APIs, protocols, and data formats.
- Keep validation at trust boundaries and avoid speculative dependencies or abstractions.
- Do not mix agent changes with pre-existing work.
- Before a compatibility break, report the changed behavior, impact, and migration.
- Validate with the narrowest relevant check. Never claim a check that was not run.

## Commands

```bash
npm run dev                 # supervisor/manager, backend, and frontend
npm run dev:manager         # supervisor and manager only
npm run dev:backend
npm run dev:frontend
npm run typecheck
npm run lint
npm run build
npm test -- test/file.test.ts
npm test -- --test-name-pattern="test name" test/file.test.ts
npm test                    # full suite
```

The integration test requires a configured `pi` command and the `/agent` extension. Pi documentation is installed at `$(npm root -g)/@earendil-works/pi-coding-agent/docs/`.



## Conventions

- Write identifiers, filenames, and code in English.
- Keep code spacious and explicit.
- Document every application function longer than four lines with English JSDoc, except obvious type guards, conversions, formatting, or local parsing. Explain purpose, contract, invariant, side effect, or rationale rather than paraphrasing code.
- Keep TypeScript strict and run Oxlint before proposing a change.
- At the end of each task, commit the changes as `<gitmoji> concise imperative subject`, without a conventional prefix.
- Before creating or modifying a visual interface in Pi Livecraft, load the `livecraft-ui` skill. Do not load it for frontend changes that have no visual impact (state, API calls, data plumbing).
