# Subagent specification

Design for delegated agents in Pi Livecraft. Each agent is a small TypeScript
module that becomes its own Pi tool and runs as one bounded child Pi session.

The extension is named `shub-agents` and keeps that name internally, including
its session marker and session-name prefix. The tools it exposes are named
`subagent_<name>`, because that is what reads clearly to a model choosing
between them.

## Status

Implemented as v2. It supersedes v1 (a single generic `shub_agent` tool
that dispatched Markdown profiles discovered at runtime). Backwards
compatibility with v1 tool calls is not provided; persisted v1 child sessions
keep working because the ownership marker is unchanged.

## Summary

An agent owns everything that makes it that agent: its prompt, tools, model,
arguments, and budgets. The extension owns everything that must be identical
across agents: process control, budget enforcement, persistence, progress, and
result shaping.

```text
parent Pi session
  └─ subagent_repo_explore({ task: "...", effort: "quick" })
       ├─ compose the child system prompt (agent prompt + budget block)
       ├─ spawn one bounded `pi --mode json --print` child
       ├─ persist the child session with durable owner metadata
       ├─ stream progress into the parent tool card
       └─ return the child's final report
```

Adding an agent means writing one module and adding it to one array.

## Goals and non-goals

Goals:

- One tool per agent, with arguments that suit that agent.
- Agent definitions are ordinary typechecked TypeScript, not parsed data.
- Every invocation is isolated, bounded, cancellable, and inspectable.
- The caller, the child, and the enforcement code share one budget vocabulary.
- Every child persists as a normal Pi session with durable parent ownership.

Non-goals:

- Runtime discovery of agents. There is no profile format, no directory
  scanning, no catalog assembly, and no per-call revalidation.
- User-supplied or project-supplied agents. Agents are code we ship and
  typecheck.
- Delegation from a child. Children never load `shub-agents`.
- Background jobs, queues, or chained workflows. Pi already runs tool calls in
  parallel, and the parent can chain across turns.
- A security sandbox. Tool selection does not make a subprocess with shell
  access safe; real container isolation is a later capability.

## Public tool surface

Each agent registers one tool named `subagent_<name>`. Its description, optional
prompt snippet and guidelines, and parameters come from the agent module.

The extension contributes these shared parameters rather than the agent:

- `effort` — deadline and tool-call budget. Exposed only when the agent declares
  more than one effort level; its description states that agent's real numbers.
- `max_chars` — integer report size limit from 1 to 100,000, defaulting to the
  agent's value. Callers choose how much synthesis they need independently of
  effort: a deep run may answer briefly, or a quick run may preserve a fuller
  report. The limit counts JavaScript string characters in the returned text.
- `images` — image paths, when the agent declares `images: true`.

Arguments are agent-specific and should be self-explanatory. Keep descriptions
and prompt guidelines short; do not add a generic wrapper schema merely to make
agents look uniform.

Callers never specify the model, the working directory, the session location,
or a timeout. Those are properties of the agent or of the environment, not of
the request. The child always runs in the parent's workspace and persists in
the standard session location for that workspace.

## Agent definition

An agent is a module under `agents/` that default-exports `defineSubagent({...})`.
The helper exists for type inference and defaults, not for registration.

| Field | Meaning |
| --- | --- |
| `name` | Tool becomes `subagent_<name>`; also the marker agent name. |
| `description` | The tool description the calling model reads. |
| `promptSnippet` | Optional one-line entry in Pi's available-tools prompt. |
| `promptGuidelines` | Optional routing bullets, each naming the tool explicitly. |
| `parameters` | TypeBox schema for this agent's own arguments. |
| `task(args)` | Builds the child's prompt text from validated arguments. |
| `systemPrompt` | The agent's own instructions. Never restates budgets. |
| `tools` | Tool names the child may use. |
| `model`, `thinking` | Fixed by the agent; a caller cannot change them. |
| `effort` | One or more levels, each with a deadline and tool-call budget. |
| `defaultEffort` | Effort used when the caller omits it. |
| `maxOutputChars` | Default report size limit. |
| `images` | Whether the tool accepts image paths. Requires a vision model. |

An effort level is `{ timeoutMs, softToolCalls, hardToolCalls }`. An agent with
one level exposes no `effort` parameter.

Effort bounds what the child spends; `max_chars` bounds what the parent pays to
receive. They are separate because a child with a large context window is often
asked to read a great deal and answer briefly.

`index.ts` imports the agents array and registers each entry. That loop applies
the shared behavior — settings resolution, budget composition, guard and marker
wiring, progress, and result shaping — so no agent can drift from it.

## Budget contract

The selected effort numbers flow unchanged through the caller-visible effort
parameter (or the description when only one level exists), the child's system
prompt, the runner timeout, and the child-side tool-call guard.

Rules that make this work:

- The soft target is lower than the hard ceiling. The gap is the room to write
  the report.
- A block is an instruction, not an error. When the guard blocks a call it
  tells the child to synthesize immediately from the evidence it already has,
  and the child stays alive to do so.
- The runner enforces the effort deadline as a hard process timeout.
- The child is told that `max_chars` limits its report, not what it may read.
  Otherwise it may under-investigate to protect a budget it is not spending.
- There is no negotiation, estimation, or pre-flight phase. The child is given
  numbers and a stop rule.

The framework appends the budget block to the agent's own system prompt. Agent
prompts never restate budget rules.

## Tool availability and settings

Agents name tools; the extension knows which environment provides them. Built-in
tools (`read`, `edit`, `write`, `bash`, `grep`, `find`, `ls`) need nothing;
`fffind` and `ffgrep` load the FFF extension from its configured path. A tool
name no agent can be given is a compile error, not a runtime diagnostic.
`bash` is full Bash access when an agent declares it; the definition must state
that capability openly.

Settings hold environment facts only: `piExecutable` and `fffExtension`. Model,
thinking level, effort, budgets, and output limits belong to agent modules.

## Runtime architecture

```text
pi-extensions/shub-agents/
├── index.ts          # settings, registration loop, run assembly, result shaping
├── define.ts         # definitions, types, and budget prompt composition
├── runner.ts         # child argv, spawn, JSON events, progress, termination
├── budget-guard.ts   # child extension: hard tool-call ceiling
├── session-marker.ts # child extension: durable ownership entry
└── agents/
    ├── index.ts      # the agents array
    ├── repo-explore.ts
    └── web-research.ts
```

The runner accepts only a resolved run specification and knows no agent names.
Child extensions receive their configuration through `PI_SHUB_*` environment
variables that agent definitions cannot influence.

### Child invocation

```text
pi --no-extensions --no-skills --no-prompt-templates --no-themes
   --no-context-files
   --mode json --print
   --name "shub-agent/<agent>: <task>"
   --extension <session-marker> --extension <budget-guard>
   [--extension <tool provider>]
   --tools <declared tools>
   --system-prompt <agent prompt + budget block>
   --model <model> --thinking <level>
   [@image ...] <task>
```

The child never receives parent conversation history, other agents'
definitions, or extension settings. It produces one final answer; the parent
result contains one short run header and that report.

## Persistence and ownership

Each run persists a real Pi session. At startup, before the prompt runs, the
session-marker extension appends a versioned custom entry:

```json
{
  "type": "custom",
  "customType": "livecraft.shub-agent",
  "data": { "version": 1, "ownerSessionId": "...", "agent": "repo_explore" }
}
```

This marker is the only classification: it survives renaming, and a session
without it is an ordinary session. If the marker write fails, the run still
works; the session simply shows up as an ordinary session, and a successful
tool result reports the missing marker.

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

Child sessions are hidden by default and never consume the ordinary session
result budget. The session-list option **Include shub-agent sessions** inserts
each child immediately beneath its owner, newest first, indented with a branch
marker. Only children whose owner is visible are included; opening a child
resumes it through the existing session-opening flow. The parent tool card
remains the primary entry point and exposes **Open shub-agent session** once
the child session path is known.

## Progress and result contract

Progress details carry agent, effort, budgets, timeout, child session id once
known, owner session id, turn and tool counters, tokens, cost, and elapsed time.
The final details add the resolved session path. Progress text reports counters
in the same units the caller and child were given. Updates are throttled UI
state and never become parent conversation content.

A successful result contains one concise run header, the child's final report,
and details with final usage and truncation state. A timeout, cancellation,
non-zero exit, or empty report fails the tool call with
bounded stderr and completed evidence, while the persisted session remains
available.

## Cancellation and lifecycle

The child is a one-shot non-RPC subprocess in its own process group;
`server/manager.ts` remains the sole owner of persistent `pi --mode rpc`
processes. On timeout or abort the runner marks the run settled, sends SIGTERM
to the group, force-kills after a bounded grace period, and only then rejects
with bounded partial evidence — never while the child may still be running.
Listeners and timers are removed on every settlement path, and an
already-aborted signal prevents spawning.

## Security notes

- Agent definitions are code, reviewed and typechecked with the repository.
  Nothing about an agent is read from untrusted files at runtime.
- Arguments are validated against the agent's schema before they reach argv.
- An agent that declares `bash` states it openly; there is no capability name
  that silently expands into shell access. Current runs do not sandbox Bash;
  container isolation with scoped read/write access is a later capability.
- Children start with global and project extensions, skills, prompt templates,
  and themes disabled, so they cannot load `shub-agents` recursively.
- Image paths are canonicalized and validated before spawn.
- Tool output, stderr, and partial evidence are bounded.
- Retrieved web content is treated as untrusted data by the agents that fetch it.

## Bundled agents

**`subagent_repo_explore`** — read-only repository exploration with `fffind`,
`ffgrep`, and `read`. No shell access. Effort: quick 45 s / 6 / 8, standard
90 s / 12 / 16, deep 180 s / 24 / 32. Default `max_chars` 12,000.

**`subagent_web_research`** — live web search and retrieval through the `ketch`
CLI over `bash`, returning a concise cited report with source URLs. The agent
has full Bash because it declares that tool; its prompt asks it to use `ketch`
for web retrieval. Effort is longer and lower in count than repository
exploration: quick 60 s / 4 / 6, standard 150 s / 8 / 12, deep 300 s / 16 / 24. Default
`max_chars` 10,000.

## Acceptance criteria

- Adding an agent requires one module and one array entry; no frontend, backend,
  or protocol change.
- A caller cannot set the model, working directory, session location, or
  timeout of a run.
- For every agent and level, the numbers in the caller-visible effort help,
  child system prompt, runner timeout, and guard environment are the same.
- `effort` and `max_chars` are chosen independently.
- Exceeding the tool ceiling blocks further tool calls with an instruction to
  synthesize, and the run can still return a report.
- A child is told up front that `max_chars` limits its report, not its reading.
- Declared tools exactly determine the child's `--tools` and loaded extensions.
- Every started run attempts the ownership marker before model execution; a
  successful result reports when the marker is missing.
- Children are hidden by default; **Include shub-agent sessions** groups them
  beneath visible owners; renaming preserves classification.
- No new backend endpoint, frontend-to-manager call, or RPC protocol; no
  database, router, state manager, UI library, or new runtime dependency.
