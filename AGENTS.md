# Agent instructions

Pi Livecraft is designed to be changed by the agents that use it. Work from evidence, change behavior at its owning boundary, and stop as soon as the request is proved.

## Start with the closest contract

For any repository task that does not name an exact file or symbol, the first repository tool call must read [`docs/README.md`](docs/README.md), even when the likely guide is already known. Read the closest guide and, when linked, its feature README in that order; do not preload unrelated documentation.

If the task names an exact file or symbol, start there. Still read the applicable guide before editing when the change crosses or depends on a documented boundary.

- Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) only when the proposed change modifies a contract across the frontend, HTTP API, manager, or Pi process boundaries. Merely inspecting a caller across a boundary does not count.
- Read [`docs/MANAGER-LIFECYCLE.md`](docs/MANAGER-LIFECYCLE.md) before changing manager runtime, supervision, or restart behavior.
- Treat facts stated by the selected guide as established evidence. Start with its named paths and verify a fact only when source contradicts it or an implementation decision remains unresolved.
- Source code and shared TypeScript types are authoritative for implementation details. Keep affected documentation aligned when its contract changes.

## Choose the exploration mode

### Read-only explanation or plan

Unless a concrete contradiction appears, use this sequence:

1. Read the routed guide and feature README.
2. Read the owning source definition named by that documentation.
3. Read at most one representative sibling or one affected integration point, whichever can change the file list or contract.
4. Identify validation from the guide, package scripts, or nearest test name. Do not read a test body when only its path or command is needed.
5. Stop and answer.

Do not walk every layer in a documented data-flow diagram or inspect all siblings, callers, styles, and tests merely to make the plan feel complete. Exceed the sequence only when a specific unresolved fact can change feasibility, files, contract, or risk; make the one call that resolves it, then reassess.

### Mutation or bug

Use only the decision gates whose condition is true; they are not a checklist, and documentation or an earlier read may already satisfy one.

- **Owner unknown** — Search the routed area for the exact identifier, route, command, label, type, or error, then read only enough of its definition to establish the contract.
- **Shared behavior changes** — Search exact usages, then read only callers whose differences could change the fix or its risk.
- **A boundary contract changes** — Read the architecture guide and the shared protocol type for that boundary.
- **Behavior is non-trivial or regressed** — Locate the nearest focused test and use it as the regression proof.
- **No unresolved decision can change the solution** — Stop exploring and edit.

For a bug, trace the common cause before protecting symptoms. For any extra tool call, identify the unresolved fact and the decision it could change; if neither is concrete, stop.

### Tool discipline

- Once the owning area is known, every `find` or `grep` must use its narrowest known path. Start with 20–30 results and refine the path or pattern before widening.
- Do not reread a file unless a different range answers a named missing fact. When documented siblings share one pattern, inspect one representative only.
- Do not open a second guide unless the selected guide reveals an uncovered boundary. Do not search for completeness.
- Ignore dependencies, generated artifacts, logs, and history unless they are the subject. Parallelize only independent reads or searches, never dependent steps or writes.
- If evidence conflicts, test one alternative hypothesis or widen one level, then reassess.

## Architecture and safety boundaries

- The React frontend communicates with the backend only through `src/api.ts`.
- `src/App.tsx` orchestrates cross-cutting state. Area-specific rendering and logic belong in `src/features/<feature>/`.
- Colocate feature CSS. Reserve `src/styles/` for global and responsive rules; `src/App.css` remains the ordered entry point.
- `server/backend.ts` owns the HTTP API and SSE stream and may restart without interrupting Pi.
- `server/manager.ts` alone owns `pi --mode rpc` processes; never move that ownership into the backend.
- Manager runtime files are declared in `server/manager-runtime-files.json`; keep it aligned with runtime imports. Edits are detected without interrupting Pi and take effect only after the user requests the guarded restart. Never restart the manager or supervisor yourself, bypass that lifecycle, or change its contract without explicit approval.
- Use Pi's public RPC protocol. Do not inspect internal files to reproduce an RPC capability.
- The application listens only on `127.0.0.1`. Do not broaden exposure without explicit authentication and scoping.
- Do not add a database, frontend router, state manager, or UI library without demonstrated need.
- Before visual UI work, load the project-specific `livecraft-ui` skill. Do not load another visual skill unless explicitly requested, and do not load any for state, API, data, or event wiring without visual impact.

## Make the smallest compatible change

- Reuse the repository's helpers, types, patterns, dependencies, and native platform capabilities before adding code.
- Add no speculative abstraction, dependency, configuration, compatibility path, or capability.
- Keep validation at trust boundaries and preserve unrelated APIs, protocols, and data formats.
- Put new files in the smallest coherent owning area. Avoid generic `utils` or `common` buckets unless shared ownership is already demonstrated.
- Remove imports, styles, files, and documentation made obsolete by the change. Do not include generated artifacts, logs, or local environment files.
- Before a compatibility break, stop and report the behavior change, impact, and migration.
- Use English for identifiers, filenames, code comments, and JSDoc. Document non-obvious application contracts, invariants, side effects, or rationale; do not document by line count or paraphrase obvious code.
- Keep TypeScript strict and code explicit. Follow the repository formatter instead of hand-formatting around it.

## Validate proportionately

Choose the smallest check that proves the changed behavior. Each command must add distinct evidence.

- Documentation or simple configuration: targeted reread or syntax check only.
- Local behavior: the nearest focused test first; add one only for non-trivial logic, a reproducible regression, or a durable contract.
- TypeScript source: run Oxlint and the focused test, typecheck, or build that covers the actual risk. Do not run every check by ritual.
- Reserve full tests and builds for cross-cutting contracts, public APIs, dependencies, security, data, or high-regression paths.
- Do not repeat a focused check inside a broader suite unless the broader run adds useful coverage.
- Reread changed files and check for accidental edits or apparent secrets. Diagnose a relevant failure; do not hide it or commit through it.

Useful commands:

```bash
npm run dev
npm run dev:manager
npm run dev:backend
npm run dev:frontend
npm run typecheck
npm run lint
npm run format:check -- <paths>
npm run build
npm test -- test/file.test.ts
npm test -- --test-name-pattern="test name" test/file.test.ts
npm test
```

The Pi RPC integration test requires a configured `pi` command. Its `/agent` coverage is skipped when that extension is unavailable. Pi documentation is installed at `$(npm root -g)/@earendil-works/pi-coding-agent/docs/`.

`npm run eval:documentation-routing` launches external model calls and may incur cost. Run it only with explicit approval.

## Preserve the worktree and finish cleanly

Before the first mutation, run `git status --short` once. Preserve all pre-existing work and inspect an existing diff only if it overlaps the files you must change.

- Stage only your files or hunks with `git add -- <targets>`; never use a blind global add.
- Commit only after relevant validation passes. Use a real Gitmoji and a concise imperative French subject, without a conventional prefix.
- Never include another contributor's changes without explicit approval, and never push implicitly.
- Report the resulting behavior and essential files, checks actually run and their result, then the commit identifier and message. Mention a risk or follow-up only when real.
