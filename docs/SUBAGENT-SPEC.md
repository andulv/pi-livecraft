# shub-agents specification

Design for generic delegated agents in Pi Livecraft. One extension dispatches one
named, declaratively defined agent per tool call, replacing the research-specific
prototype. Backwards compatibility with the old `research` tool and its stored
calls is not a concern.

The extension is named lower-case `shub-agents`; the public Pi tool is
`shub_agent`, because tool identifiers use underscores.

## Status

Implemented (v1).

## Summary

Agent behavior is configuration; process control, validation, budgets,
persistence, and progress are code.

```text
parent Pi session
  └─ shub_agent({ agent: "research", task: "...", effort: "quick" })
       ├─ find and validate research.md
       ├─ resolve its tools and model
       ├─ spawn one bounded `pi --mode json --print` child
       ├─ persist the child session with durable owner metadata
       ├─ stream progress into the parent tool card
       └─ return the child's final report
```

Adding an agent requires one Markdown profile and no TypeScript change.

## Goals and non-goals

Goals:

- One generic extension and one `shub_agent` tool.
- Add and tune agents declaratively.
- Each invocation is isolated, bounded, cancellable, and inspectable.
- Every child persists as a normal Pi session with durable parent ownership.
- Children appear, on request, indented beneath their owner session.
- Agent catalog and diagnostics stay out of the parent context.

Non-goals for v1:

- Background jobs, polling, chained or queued workflows (Pi already supports
  parallel tool calls; the parent can chain across turns).
- Delegation from a child. Children never load `shub-agents`, and no
  delegation tool is exposed to them.
- Agent inheritance, templates, hooks, or a per-agent tool/schema.
- A read-only session viewer. The tool card and the existing open-session flow
  cover inspection; a dedicated viewer can come later.
- A security sandbox. Tool selection reduces exposure but does not turn a
  subprocess with shell access into a sandbox.

## Public tool contract

```ts
shub_agent({
  agent: string            // name of a discovered profile
  task: string             // bounded assignment and requested evidence
  effort?: 'quick' | 'standard' | 'deep'
  images?: string[]        // paths relative to the resolved cwd
  cwd?: string             // resolved from the owner's workspace
  model?: string           // per-call override
  timeoutMs?: number       // per-call ceiling, clamped to [1 s, 1 h]
}) => agent report
```

The tool accepts exactly one run per call. The tool registers no `promptSnippet`
and no `promptGuidelines`; its description carries the dispatch sentence, the
agent catalog (see below), and one effort sentence. Everything else — profile
bodies, settings, diagnostics — is resolved only after a call selects an agent.

### Parent-context budget

- profile name: 1–32 characters, `a-z0-9-`;
- profile description: at most 200 characters;
- catalog exposes at most 12 agents, deterministic by name;
- the full tool description stays at or below 2,700 characters.

When agents exceed the limits, the first 12 by name are exposed and the omitted
names are logged through the extension console for the host to observe.

Profiles are rediscovered and validated when the extension loads and again at
each call, so adding, editing, or removing a profile takes effect on the next
call or after Pi's normal reload flow, whichever comes first.

## Profile format

Profiles are Markdown with YAML frontmatter. The body is the agent's complete
role and output instructions.

```md
---
name: reviewer
description: Reviews code for correctness and maintainability. Use after a non-trivial implementation.
tools: [read, fffind, ffgrep]
model: anthropic/claude-sonnet-4-5
thinking: medium
defaultEffort: standard
projectContext: false
---

You are a senior code reviewer. ...
```

| Field | Required | Rules |
|---|---:|---|
| `name` | yes | Lower-case `a-z0-9-`, 1–32 chars, unique across loaded scopes. |
| `description` | yes | What it does, then when to use it; at most 200 characters. |
| `tools` | yes | Non-empty list of tool names from the host tool registry. |
| `model` | no | `provider/model`; omission uses the setting, then no `--model` flag. |
| `thinking` | no | Valid Pi thinking level; omission uses the setting, then no flag. |
| `defaultEffort` | no | `quick`, `standard`, or `deep`; default `standard`. |
| `projectContext` | no | Load AGENTS.md-style context files into the child; default false. |
| Markdown body | yes | Non-empty system prompt, at most 12,000 characters. |

Unknown fields are errors. One invalid file never prevents valid profiles from
loading; invalid and colliding profiles are excluded and reported with their
source path and reason.

Profiles are data, never executable instructions for the host. They cannot
declare extension paths, raw child arguments, environment variables, timeouts,
or executables. Those are host policy.

### Profile locations and trust

```text
pi-extensions/shub-agents/agents/*.md   bundled profiles
~/.pi/agent/shub-agents/*.md            user profiles
<workspace>/.pi/shub-agents/*.md        project profiles
```

Discovery is non-recursive over regular `.md` files (plus symlinks whose target
stays inside the directory). Project profiles load only when
`ctx.isProjectTrusted()` is true. A name collision excludes all colliding
definitions; there is no silent override. To remove an agent from the catalog,
remove or rename its file.

## Tool registry

The profile names tools; the extension supplies them. A small code-owned
registry maps each tool name to its provider:

- built-in tools (`read`, `edit`, `write`, `bash`, `grep`, `find`, `ls`) need
  no extension;
- `fffind` and `ffgrep` load the FFF extension, whose path is the advanced
  `fffExtension` setting;
- any other name makes the profile invalid.

The child receives exactly the declared tools via `--tools` and exactly the
extensions those tools require, plus the two internal extensions below. An
agent that needs shell access declares `bash` itself; nothing grants shell
implicitly, and no profile is ever described as enforced read-only when it
lists `bash`.

## Budgets and settings

Effort is a stable caller contract shared by all profiles:

| Effort | Timeout | Tool calls soft/hard | Intended scope |
|---|---:|---:|---|
| `quick` | 90 s | 6 / 8 | One narrow lookup or focused check. |
| `standard` | 240 s | 12 / 16 | One feature map or focused investigation. |
| `deep` | 600 s | 24 / 32 | Multi-angle audit or substantial synthesis. |

Profiles may choose a default effort but cannot redefine budgets.

The `shub-agents` settings group tunes host policy: default model, thinking
level, default effort, timeout override, maximum output characters, FFF
extension path, and Pi executable. Resolution order is per-call value, profile
value, setting, code default. Values resolve per call, so a change applies to
the next call without reloading Pi.

## Runtime architecture

```text
pi-extensions/shub-agents/
├── index.ts          # discovery, catalog, settings, shub_agent tool, run assembly
├── profile.ts        # frontmatter parsing, validation, discovery, catalog text
├── runner.ts         # child argv, spawn, JSON events, progress, termination
├── budget-guard.ts   # child extension: hard tool-call ceiling
├── session-marker.ts # child extension: durable ownership entry
└── agents/research.md
```

The runner accepts only a resolved run specification and knows no agent names.
Internal child extensions receive their configuration through `PI_SHUB_*`
environment variables that profiles cannot influence.

### Child invocation

```text
pi --no-extensions --no-skills --no-prompt-templates --no-themes
   --no-context-files            # omitted only when projectContext is true
   --mode json --print
   --name "shub-agent/<agent>: <task>"
   --extension <session-marker> --extension <budget-guard>
   [--extension <tool provider>]
   --tools <declared tools>
   --system-prompt <profile body + effort guidance>
   [--model <model>] --thinking <level>
   [@image ...] <task>
```

The child never receives parent conversation history, the agent catalog, other
profile bodies, or extension settings. It produces one final answer; the parent
result contains one short run header and that report.

## Persistence and ownership

Each run persists a real Pi session. At startup, before the prompt runs, the
session-marker extension appends a versioned custom entry:

```json
{
  "type": "custom",
  "customType": "livecraft.shub-agent",
  "data": { "version": 1, "ownerSessionId": "...", "agent": "research" }
}
```

This marker is the only classification: it survives renaming, and a session
without it is an ordinary session. If the marker write fails, the run still
works; the session simply shows up as an ordinary session, and the tool result
reports the missing marker so the condition is observable, never silent.

`server/pi-session-store.ts` reads the marker while scanning session metadata
and returns optional structured fields on `RecentSession`:

```ts
interface RecentSession {
  // existing fields
  shubAgent?: string        // agent name from the marker
  ownerSessionId?: string   // owner id from the marker
}
```

No new HTTP endpoint or manager protocol is required. Renaming a child changes
only its display name; opening or renaming a child never promotes it to an
ordinary session.

## Session-list behavior

Shub-agent sessions are hidden by default and never consume the ordinary
session result budget. The session-list option **Include shub-agent sessions**
inserts each child immediately beneath its owner, newest first, indented with a
branch marker. Only children whose owner is visible are included; opening a
child resumes it through the existing session-opening flow. The parent tool
card remains the primary entry point and exposes **Open shub-agent session**
once the child session path is known.

## Progress and result contract

Progress details carry agent, cwd, model, effort, timeout, child session id and
path once known, owner session id, turn and tool counters, budgets, tokens,
cost, and elapsed time. Updates are throttled and are UI state only; they never
become parent conversation content.

A successful result contains one concise run header, the child's final report,
and structured details with final usage and truncation state. A timeout,
cancellation, non-zero exit, or empty report fails the tool call with bounded
stderr and completed evidence, while the persisted session remains available.

## Cancellation and lifecycle

The child is a one-shot non-RPC subprocess in its own process group;
`server/manager.ts` remains the sole owner of persistent `pi --mode rpc`
processes. On timeout or abort the runner: marks the run settled, sends
SIGTERM to the group, force-kills after a bounded grace period, and only then
rejects with bounded partial evidence — never while the child may still be
running. Listeners and timers are removed on every settlement path, and an
already-aborted signal prevents spawning.

## Security notes

- Profiles are untrusted data; frontmatter cannot inject argv, environment, or
  executable paths.
- Project profiles require Pi project trust.
- Children start with global/project extensions, skills, prompt templates, and
  themes disabled, so they cannot load `shub-agents` recursively.
- `cwd` and image paths are canonicalized and validated before spawn.
- Tool output, stderr, and partial evidence are bounded.
- Retrieved web content is treated as untrusted data in relevant profile
  prompts.

## Initial bundled profile

`research.md` preserves the behavior of the prototype: repository discovery
(`fffind`, `ffgrep`, `read`), internet retrieval through the `ketch` CLI over
`bash`, image inspection, and a cited brief. Its body owns research-specific
guidance; nothing research-specific remains in extension code.

## Acceptance criteria

- Adding a valid profile file and reloading exposes it in the catalog; invalid,
  duplicate, and untrusted profiles never run and report actionable reasons.
- A new profile needs no TypeScript or frontend change.
- Profile bodies and disabled profiles never appear in parent context; the tool
  description stays within its 2,700-character budget.
- `shub_agent({ agent: "research", ... })` runs the bundled profile; unknown
  agents fail with the available names.
- Resolved tools/extensions exactly match the declared tools.
- Effort budgets and timeout/cancel behavior are enforced; usage, cost, and
  failure diagnostics are bounded and accurate.
- Every started run attempts the ownership marker before model execution; a
  missing marker is reported, never silent.
- Children are hidden by default; **Include shub-agent sessions** groups them
  beneath visible owners; renaming preserves classification.
- No new backend endpoint, frontend-to-manager call, or RPC protocol; no
  database, router, state manager, UI library, or new runtime dependency.
