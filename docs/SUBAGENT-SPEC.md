# shub-agents specification

Design specification for generic delegated agents in Pi Livecraft. This replaces
the existing research-specific design. The current `research` extension and its
hardcoded profile are prototypes to be removed, not compatibility constraints.

The name is deliberately lower-case: `shub-agents`. The public Pi tool uses the
identifier `shub_agent`, because tool identifiers use underscores rather than
hyphens.

## Status

Proposed, not implemented.

The current research implementation proves subprocess execution, progress,
cancellation, persisted child sessions, and session-list grouping. Its reusable
lessons should be retained, but its public tool, profile constants, filenames,
and name-based ownership format should not shape the new API.

## Summary

`shub-agents` is one Pi extension that dispatches one named, declaratively
defined agent per tool call. Agent behavior is configuration; process control,
validation, budgets, persistence, progress, and security policy are code.

```text
parent Pi session
  └─ shub_agent({ agent: "research", task: "...", effort: "quick" })
       ├─ discover and validate research.md
       ├─ resolve capabilities through a code-owned catalog
       ├─ spawn one bounded `pi --mode json --print` child
       ├─ persist child session plus durable owner metadata
       ├─ stream progress into the parent tool card
       └─ return the child's final report
```

Adding a normal agent requires one Markdown profile and no new extension, tool,
runner, frontend presentation, or server route.

## Goals

- One generic `shub-agents` extension and one `shub_agent` tool.
- Add and tune agents declaratively without TypeScript changes.
- Keep each invocation isolated, bounded, cancellable, and inspectable.
- Persist every child as a normal Pi session with durable parent ownership.
- Show opted-in children indented directly beneath a visible owner session.
- Make available agents and their intended use clear to the calling model within
  a fixed parent-context budget.
- Keep full profile prompts, diagnostics, settings, and capability details out of
  the parent context.
- Enforce capabilities through a small code-owned catalog rather than arbitrary
  command-line fragments in profile files.
- Support bundled, user, and trusted project profiles with deterministic
  discovery and validation.
- Keep the first release small: one foreground child per tool call.

## Non-goals for the first release

- Compatibility with the current `research` tool or its stored calls.
- One extension or one tool per agent.
- Background jobs or polling.
- Extension-managed parallel or chained workflows.
- Recursive delegation from a child.
- Agent inheritance, templates, or executable hooks.
- Arbitrary extension paths or command-line arguments in agent profiles.
- A read-only session viewer.
- Cross-session cost aggregation.
- A security sandbox. Capability restriction reduces exposure but does not turn
  a subprocess with shell access into a sandbox.

Pi already supports parallel tool calls. A parent may invoke multiple
`shub_agent` calls in one turn; each remains an independent child session. A
parent may chain calls across turns by passing previous results in the next
task. The extension should not duplicate orchestration in v1.

## Terminology

- **extension** — the single `shub-agents` Pi extension loaded into persistent
  Livecraft sessions.
- **profile** — one validated Markdown agent definition.
- **agent** — the named behavior described by a profile, such as `research` or
  `reviewer`.
- **run** or **child** — one bounded Pi subprocess created for one tool call.
- **owner** — the persistent parent Pi session that invoked the child.
- **capability** — a code-owned bundle of allowed tools and required child
  extensions.

## Public tool contract

```ts
shub_agent({
  agent: string
  task: string
  effort?: 'quick' | 'standard' | 'deep'
  images?: string[]
  cwd?: string
  model?: string
  timeoutMs?: number
}) => agent report
```

| Parameter | Required | Meaning |
|---|---:|---|
| `agent` | yes | Name of a discovered profile. |
| `task` | yes | Bounded assignment and requested evidence/output. |
| `effort` | no | Shared budget preset; profile default, then global default. |
| `images` | no | Image paths relative to the resolved `cwd`; requires profile vision capability. |
| `cwd` | no | Child working directory, resolved from the owner's workspace. |
| `model` | no | Explicit per-call override when overrides are enabled by settings. |
| `timeoutMs` | no | Advanced per-call ceiling, clamped by host policy. |

The tool accepts exactly one run. There are no `tasks`, `parallel`, or `chain`
shapes in v1.

### Parent-context contract

The extension must not publish profile implementation details into the parent
prompt. `shub_agent` has one short generic description:

```text
Delegate a bounded task to one of the available specialist agents.
```

Each enabled profile announces only its name followed by two short sentences:

1. **What it does.**
2. **When to use it.**

Example:

```text
research — Investigates repositories, web sources, and images with cited evidence. Use when a question spans files or external sources.
reviewer — Reviews code for concrete correctness and maintainability issues. Use after a non-trivial implementation or before merging.
```

That is the entire agent catalog visible to the parent. The full profile body,
model, thinking level, capabilities, source path, validation diagnostics,
settings, report format, and safety policy are resolved only after a tool call
selects an agent.

The tool registers no `promptSnippet` and no `promptGuidelines`; both would
repeat information already present in the tool schema and agent announcements.
Concise parameter descriptions explain `agent`, `task`, and `effort` without
restating execution internals.

Context limits are enforced as data validation rather than editorial advice:

- profile name: at most 32 characters;
- profile announcement: exactly two non-empty sentences and at most 200
  characters;
- enabled profiles exposed to one session: at most 12;
- rendered catalog: at most 2,500 characters;
- generic tool description plus catalog: at most 2,700 characters
  (approximately 675 tokens), excluding the provider-required parameter schema.

If enabled profiles exceed the limit, the extension exposes the deterministic
first 12 by name and reports the omitted names through diagnostics. The
`enabledAgents` setting is the intended way to keep a large installed catalog
focused per Livecraft installation. Unknown-agent errors return only a bounded
list of enabled names, not announcements or diagnostics.

Profile files are rediscovered and validated when the extension loads or Pi
reloads. Execution resolves the selected profile again so removed or invalid
files fail safely rather than running stale configuration. Adding or changing a
profile becomes model-visible after Pi's normal reload flow.

## Profile format

Profiles are Markdown with YAML frontmatter. The body is the agent's complete
role and output instructions.

```md
---
name: reviewer
description: Reviews code for correctness, safety, and maintainability. Use after implementation or before merging.
capabilities: [repo-read]
model: anthropic/claude-sonnet-4-5
thinking: medium
defaultEffort: standard
projectContext: true
---

You are a senior code reviewer.

Return:
1. Overall assessment.
2. Findings ordered by severity.
3. Evidence using file:line references.
4. Focused validation suggestions.
```

### Profile schema

| Field | Required | Rules |
|---|---:|---|
| `name` | yes | Lower-case `a-z0-9-`, unique across all loaded scopes. |
| `description` | yes | Two sentences: what it does, then when to use it; maximum 200 characters. |
| `capabilities` | yes | Non-empty list of names from the host capability catalog. |
| `model` | no | `provider/model`; omission uses the configured default, then owner model. |
| `thinking` | no | Valid Pi thinking level; omission uses the configured/profile fallback. |
| `defaultEffort` | no | `quick`, `standard`, or `deep`; default `standard`. |
| `projectContext` | no | Load workspace context files into the child; default false. |
| Markdown body | yes | Non-empty system prompt for the child. |

Unknown fields are errors. Invalid profiles are excluded from the catalog and
reported through diagnostics with their source path and reason. One invalid file
must not prevent valid profiles from loading.

Profiles cannot declare:

- filesystem paths to extensions;
- raw child arguments;
- environment variables;
- timeout or tool-call ceilings;
- arbitrary executables;
- owner/session metadata;
- recursive delegation.

Those are host policy, not agent behavior.

## Profile locations and trust

```text
pi-extensions/shub-agents/agents/*.md   bundled Livecraft profiles
~/.pi/agent/shub-agents/*.md            user profiles
<workspace>/.pi/shub-agents/*.md        project profiles
```

Discovery is non-recursive and accepts regular `.md` files and symlinks whose
resolved target remains within the selected profile directory.

Scopes:

- Bundled profiles always load.
- User profiles always load.
- Project profiles load only when `ctx.isProjectTrusted()` is true.
- The generic tool has no per-call scope selector. Trust and installation
  determine the catalog before the model chooses an agent.

Profile names must be globally unique across loaded scopes. A collision excludes
all colliding definitions and reports a diagnostic; there is no silent override
or precedence rule in v1. This makes the selected behavior deterministic and
prevents a project profile from impersonating a bundled or user agent.

## Capability catalog

Profiles name capabilities; TypeScript resolves capabilities into concrete
child tools and extension entry points.

Initial catalog:

| Capability | Child tools | Child extensions | Notes |
|---|---|---|---|
| `repo-read` | `read`, `fffind`, `ffgrep` | FFF | Repository discovery and file evidence. |
| `web` | dedicated retrieval tools when available; otherwise `bash` | retrieval transport | Shell fallback is prompt-restricted, not sandboxed. |
| `vision` | none | none | Permits image arguments with a vision-capable model. |
| `shell` | `bash` | none | Explicit arbitrary shell capability. |
| `workspace-write` | `read`, `write`, `edit` | required mutation support | Deferred until a concrete writing agent is approved. |

The catalog owns:

- allowed tool names;
- required child extensions;
- whether images are permitted;
- whether the profile is read-only by construction;
- warnings shown in diagnostics/settings;
- any future trust or confirmation requirements.

The extension rejects unknown capabilities. It deduplicates resolved tools and
extensions and always adds the internal budget guard and session marker.

`bash` is inherently mutation-capable. A `web` implementation backed by `bash`
cannot honestly be called enforced read-only. The preferred direction is a
dedicated child retrieval tool so `web` does not imply shell access.

## Budgets and settings

Effort remains a stable caller contract shared by all profiles:

| Effort | Timeout ceiling | Tool calls soft/hard | Intended scope |
|---|---:|---:|---|
| `quick` | 90 s | 6 / 8 | One narrow lookup, image, or focused check. |
| `standard` | 240 s | 12 / 16 | One feature map, review, or focused investigation. |
| `deep` | 600 s | 24 / 32 | Multi-angle audit or substantial synthesis. |

The extension publishes one `shub-agents` settings group. Settings tune host
policy and defaults, not agent definitions:

- enabled agent names (used to keep the parent catalog focused);
- default model;
- default thinking level;
- default effort;
- optional bounded timeout override;
- maximum returned output characters;
- executable/known extension locations as advanced host settings;
- whether per-call model and timeout overrides are allowed.

Profiles may choose a default effort but cannot redefine effort budgets. This
keeps `quick`, `standard`, and `deep` comparable across agents.

Resolution order:

1. permitted per-call override;
2. profile value;
3. `shub-agents` setting;
4. owner session model/thinking where applicable;
5. code default.

Every resolved model is checked for availability. Image calls additionally
require a vision-capable resolved model.

## Runtime architecture

### Parent extension

`pi-extensions/shub-agents/index.ts` owns:

- profile discovery and catalog publication;
- `shub_agent` tool registration;
- parameter and policy validation;
- profile/settings/capability resolution;
- owner identity capture;
- progress and final result shaping.

It contains no agent-specific prompt text.

### Registry

`pi-extensions/shub-agents/registry.ts` owns:

- profile directories and trust-aware discovery;
- YAML/frontmatter parsing;
- strict schema validation;
- duplicate detection;
- deterministic sorting;
- diagnostic records;
- capability resolution.

Discovery returns immutable resolved profiles and diagnostics. Callers never
consume raw frontmatter.

### Child runner

`pi-extensions/shub-agents/runner.ts` owns:

- child argv construction;
- process-group spawning;
- JSON event parsing;
- progress throttling;
- usage aggregation;
- output/evidence limits;
- timeout and abort handling;
- graceful then forced termination;
- child session-file lookup.

The runner accepts only a resolved run specification. It knows no agent names or
profile locations:

```ts
interface ResolvedShubRun {
  agent: string
  task: string
  cwd: string
  images: string[]
  sessionName: string
  systemPrompt: string
  model?: string
  thinking: ThinkingLevel
  tools: string[]
  extensions: string[]
  effort: EffortLevel
  softToolCalls: number
  hardToolCalls: number
  timeoutMs: number
  maxOutputChars: number
  ownerSessionId: string
  ownerSessionPath: string
}
```

### Internal child extensions

Two internal extensions are always loaded explicitly while global/project Pi
extensions, skills, prompt templates, and themes are disabled:

1. **budget guard** — enforces the hard tool-call ceiling inside the child.
2. **session marker** — appends durable ownership metadata to the child session
   at startup.

The child receives only resolved capability extensions in addition to these two.
It never inherits the owner's extension set, preventing recursion and accidental
capability expansion.

### Child invocation

```text
pi --no-extensions --no-skills --no-prompt-templates --no-themes
   --mode json --print
   [--no-context-files]
   --name "shub-agent/<agent>: <task>"
   --extension <session-marker>
   --extension <budget-guard>
   [--extension <resolved-capability-extension> ...]
   --tools <resolved-tool-list>
   --system-prompt <profile body + bounded effort instructions>
   [--model <model>]
   --thinking <level>
   [@image ...]
   <task>
```

`--no-context-files` is the default. It is omitted only when the selected
profile explicitly sets `projectContext: true`. The child never receives parent
conversation history, the agent catalog, other profile bodies, extension
settings, or registry diagnostics.

Owner id, owner session path, selected agent, and budget values are passed to
internal extensions through narrowly named environment variables. Profile files
cannot set or override them.

## Persistence and ownership

Each run persists a real Pi session. Ownership is stored as a versioned custom
session entry, not encoded only in the display name:

```json
{
  "type": "custom",
  "customType": "livecraft.shub-agent",
  "data": {
    "version": 1,
    "ownerSessionId": "...",
    "ownerSessionPath": "...",
    "agent": "research"
  }
}
```

The session-marker child extension writes this entry during `session_start`
before the child prompt runs. The display name remains readable:

```text
shub-agent/research: map session persistence
```

The custom marker is authoritative for ownership and classification. Renaming a
child does not change its identity or grouping. A run without a valid marker is
not treated as a shub-agent session and produces a diagnostic; the implementation
must ensure marker failure causes the run to fail before model execution so it
cannot silently leak into the ordinary list.

`server/pi-session-store.ts` reads the marker while scanning session metadata and
returns optional structured fields on `RecentSession`:

```ts
interface RecentSession {
  // existing fields
  sessionKind?: 'shub-agent'
  ownerSessionId?: string
  shubAgent?: string
}
```

No new HTTP endpoint or manager protocol is required.

## Session-list behavior

By default, shub-agent sessions do not appear in the ordinary workspace session
list and do not influence workspace activity ordering or automatic session
selection.

The session-list option is:

```text
Include shub-agent sessions
```

When enabled:

- ordinary sessions keep their normal newest-first order;
- only children whose `ownerSessionId` matches an ordinary owner present in the
  final visible list are included;
- each child appears immediately beneath its owner;
- siblings are newest-first;
- child rows are indented and use a branch connector plus a child marker;
- child title and agent identity remain readable at narrow widths;
- archived/filtered/pinned owner handling is applied before child inclusion;
- an absent or hidden owner means none of its children appear;
- opening a child resumes it through the existing session-opening flow;
- opening or renaming a child never promotes it to an ordinary session.

The parent tool card remains the primary entry point and exposes **Open
shub-agent session** after the child session path is known. The grouped list is
the secondary inspection/debugging surface.

The server keeps separate recent-result budgets for ordinary sessions and
shub-agent sessions so frequent children cannot crowd owners out before frontend
grouping.

## Context-efficiency rules

Context efficiency is a feature invariant across both processes.

### Parent

- Exactly one generic tool is registered, regardless of agent count.
- Its generic description is one dispatch sentence.
- Each enabled agent contributes only “what it does” and “when to use it.”
- No prompt snippet, prompt guidelines, per-agent tool, or per-agent schema is
  registered.
- Profile diagnostics are available through UI/diagnostics, not model context.
- Progress updates are UI state and do not become parent conversation content.
- The final result contains one short metadata line and one report; it does not
  repeat the task, profile prompt, capability list, progress history, or raw
  child events.
- Large structured data belongs in tool-result `details`, not visible text sent
  back to the parent model.

### Child

- The child receives the task, selected profile body, compact effort/output
  policy, selected tool definitions, optional images, and explicitly requested
  project context—nothing else.
- Global/project extensions, skills, prompt templates, and themes are disabled.
- Project context files are opt-in per profile and loaded through Pi's native
  context mechanism rather than copied into the profile prompt.
- Capability resolution selects the smallest exact tool set; profiles should
  not receive broad default tools.
- Profile bodies state role, decision rules, and output contract. They must not
  duplicate Pi's tool schemas, generic safety text already enforced by the host,
  effort tables, or catalog descriptions.
- Profile bodies are capped at 12,000 characters. Larger profiles are invalid;
  recurring specialist knowledge should become a narrowly loaded context file
  or capability, not an ever-growing system prompt.
- The child produces one final answer. Intermediate assistant text is retained
  in the child session but not concatenated into the parent result.

### Measurement

Focused tests snapshot the registered tool metadata and assembled child argv /
system prompt. They fail when the generic description plus catalog exceeds
2,700 characters, disabled profile bodies leak into the prompt, unrelated tools are
selected, or child system-prompt layers are duplicated.

## Progress and result contract

Progress updates contain stable generic details:

```ts
interface ShubAgentProgressDetails {
  agent: string
  cwd: string
  model?: string
  effort: EffortLevel
  timeoutMs: number
  childSessionId?: string
  childSessionPath?: string
  ownerSessionId: string
  turnCount: number
  toolCount: number
  softToolCalls: number
  hardToolCalls: number
  totalTokens: number
  costUsd: number
  elapsedMs: number
}
```

The first update says which agent/model/effort is starting. Later updates name
the current tool and budget. Once the session can be located, progress details
include its path so the UI may expose the open action before completion.

A successful result contains:

1. one concise run header;
2. the child agent's final report;
3. the same structured details plus final usage and truncation state.

A timeout, cancellation, non-zero exit, provider error, or empty final report is
a failed tool call. Diagnostics include bounded stderr and completed evidence,
while the persisted session remains available when its marker was written.
Raw JSON event lines are never returned as the agent report.

## Cancellation and process ownership

The child is a one-shot non-RPC subprocess started by the extension inside its
owner Pi process. `server/manager.ts` remains the sole owner of persistent
`pi --mode rpc` processes.

The runner creates a process group where supported. Parent abort or timeout:

1. marks the run settled so no later progress is emitted;
2. sends graceful termination to the process group;
3. waits a bounded grace period;
4. force-kills the group if necessary;
5. rejects with bounded partial diagnostics.

An already-aborted signal prevents spawning. Listeners and timers are removed on
every settlement path.

## Security and trust model

- Profiles are untrusted data, never executable instructions for the host.
- Project profiles are ignored unless Pi reports the project trusted.
- Profile frontmatter cannot inject argv, environment, executable paths, or
  extension paths.
- Capability names resolve through a code-owned allowlist.
- Children start with global and project extensions/resources disabled.
- Children cannot load `shub-agents`, so recursion is unavailable.
- `cwd` and image paths are canonicalized and validated before spawn.
- Tool output and stderr are bounded.
- Retrieved web content is treated as untrusted data in relevant profile prompts.
- Shell access is explicitly represented by capability and must not be described
  as enforced read-only.

A future mutation capability requires a separate design review covering trust,
file queues, concurrent children, and user confirmation. It is not enabled merely
by adding `workspace-write` to a profile.

## Initial bundled profile

The first bundled profile is `research.md`. It preserves the useful behavior of
the prototype without preserving its implementation:

```yaml
name: research
description: Investigates repositories, web sources, and images with cited evidence. Use when a question spans files or external sources.
capabilities: [repo-read, web, vision]
model: openrouter/z-ai/glm-5.3-flash
thinking: off
defaultEffort: standard
projectContext: true
```

Its Markdown body owns research-specific tool guidance and report structure.
No research prompt, model, tool list, or description remains in extension code.

Subsequent read-only agents such as `reviewer` or `planner` are added only as
validated profile files. A genuinely new host capability may require one catalog
entry in code, but it must not require a new extension or runner.

## Proposed file layout

```text
pi-extensions/shub-agents/
├── index.ts
├── profile.ts
├── registry.ts
├── capabilities.ts
├── runner.ts
├── budget-guard.ts
├── session-marker.ts
└── agents/
    └── research.md

shared/shub-agent-session.ts
server/pi-session-store.ts
src/features/conversation/OpenShubAgentSessionButton.tsx
src/features/workspace/sidebar-sessions.ts
src/features/workspace/workspace.css
test/shub-agent-profile.test.ts
test/shub-agent-runner.test.ts
test/shub-agent-session.test.ts
test/sidebar-sessions.test.ts
test/pi-session-store.test.ts
```

`server/pi-process.ts` loads only `pi-extensions/shub-agents/index.ts`. The
research-specific extension and old subagent runner/guard files are deleted as
part of implementation.

## Implementation sequence

1. Define strict profile and capability types plus discovery tests.
2. Add bundled `research.md` and prove it resolves to the expected run spec.
3. Move and generalize the runner, budget guard, and progress/result details.
4. Add the session-marker extension and server-side custom-entry parsing.
5. Register `shub_agent`; remove `research` entirely with no wrapper or legacy
   argument handling.
6. Replace name-prefix session classification with structured marker fields.
7. Rename conversation actions and session-list labels to `shub-agent` language.
8. Delete research-specific and obsolete subagent files, settings definitions,
   tests, and documentation.
9. Run focused tests, typecheck, lint, build, and one end-to-end bundled-profile
   invocation.
10. Restart the manager only through Livecraft's guarded user-requested lifecycle.

## Acceptance criteria

### Profiles

- Adding a valid enabled user profile file and reloading exposes its bounded
  name/description entry in the tool catalog.
- Adding a valid trusted project profile does the same.
- Untrusted project profiles are absent.
- Invalid and duplicate profiles never run and produce actionable diagnostics.
- A new profile using existing capabilities requires no TypeScript or frontend
  change.
- Full profile bodies and disabled profiles never appear in parent context.
- The generic description plus agent catalog remains within its 2,700-character
  budget at maximum catalog size.
- Every catalog entry contains only “what it does” and “when to use it.”

### Execution

- `shub_agent({ agent: "research", ... })` runs the bundled profile.
- Unknown agents fail with the current available-agent list.
- Resolved tools/extensions exactly match declared capabilities.
- Quick/standard/deep budgets and timeout/cancel behavior are enforced.
- Usage, cost, progress, final output, and failure diagnostics are bounded and
  accurate.
- Child processes cannot load `shub-agents` recursively.

### Persistence and UI

- Every started run writes a versioned ownership marker before model execution.
- Children are hidden by default and never consume the ordinary-session result
  budget.
- **Include shub-agent sessions** inserts only children of visible owners.
- Child rows are unmistakably indented beneath owners in light/dark themes and
  narrow layouts.
- Child renaming preserves classification and ownership.
- The tool-card action opens the correct child workspace/session.

### Boundaries

- No new backend endpoint, frontend-to-manager call, or RPC protocol is added.
- `server/manager.ts` remains the only owner of RPC Pi processes.
- No database, router, state manager, UI library, or new runtime dependency is
  introduced.

## Explicit decisions

1. The feature and extension are named lower-case `shub-agents`.
2. The sole public tool is `shub_agent`.
3. Agent definitions are Markdown configuration; runtime and capabilities are
   TypeScript policy.
4. There is no compatibility contract with the research prototype.
5. There is no separate tool or extension per agent.
6. V1 executes one foreground child per call; Pi handles parallel tool calls.
7. Profile collisions are errors, not overrides.
8. Project profiles require Pi project trust.
9. Capabilities are catalog names, not raw tool/extension paths.
10. Ownership is a durable custom session entry, not a display-name convention.
11. Children appear only beneath a visible owner when explicitly included.
12. Research is the first bundled profile, not a special runtime path.
13. The generic description plus agent catalog has a fixed 2,700-character
    ceiling; the required parameter schema is measured separately.
14. Project context files are opt-in per profile; other Pi resources stay off.
