# Subagent sessions specification

A specification and task plan, not a guide. This describes the first, minimal
version of real subagents in Pi Livecraft. It has not been implemented yet.

## Summary

A **subagent** is a bounded one-shot Pi run started by a tool inside the
persistent session's Pi process. The first subagent is the **research
assistant**: one advanced, vision-capable, large-context model that can read
the local repo (fff + read) and the internet, and returns a research brief.
It replaces today's `repo_explore_ff` and `analyze_image` nested runs and
ad-hoc web-search turns with a single tool.

The caller controls cost and wall time through an **effort** preset — the same
quick / standard / deep budgets `repo_explore_ff` used — because the subagent
model is powerful enough that an unbounded call can run for minutes.

Subagent runs are **visible as ordinary sessions**: the child Pi persists a
session file in the workspace's standard Pi session directory, so it appears
in recent sessions and opens in the normal conversation view for debugging,
while the parent's tool card streams live progress. No new endpoints, no
manager changes, no protocol changes.

## Requirements

- One tool, `research`, with a task plus effort control; quick calls land in
  1–30 s, deep research may run for minutes.
- Live view of what the subagent is doing, and a session-level transcript for
  debugging after (or while) it runs — like any other session.
- Vision input (screenshots/images) without a separate image tool.
- Retire `repo_explore_ff` and `analyze_image` without losing their strengths:
  effort budgets, timeout with partial-evidence recovery, model/effort
  settings.

## Prior art

| Source | Mechanism | Lesson taken |
|---|---|---|
| [Official example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/) | `pi --mode json -p --no-session` subprocess; agents as markdown + frontmatter | Agent definition layer; usage tracking; launcher resolution |
| [pi-subagents](https://github.com/nicobailon/pi-subagents) | In-process SDK sessions, foreground + background | `researcher` agent brief format; model-tier expectations |
| [pi-agents](https://github.com/sebastienservouze/pi-agents) | In-process SDK sessions, **no session file** | `delegate:` allowlist gate; prompt composition. Rejected as mechanism: in-memory children cannot be opened or audited as sessions |
| `repo_explore_ff` + `budget-guard` (backup of this project's own tool) | One-shot `pi --mode json --print` subprocess | Effort presets with soft/hard tool-call budgets; partial-evidence recovery on timeout — kept as the core |

## Design decisions

**D1 — Subprocess child, not in-process.** The tool spawns a detached
one-shot `pi --mode json --print` child. This matches the existing
`repo_explore_ff`/`analyze_image` precedent, keeps children killable and
restart-resilient, and avoids coupling to SDK internals. In-process sessions
(pi-agents style) are not used in v1: their defining property — no persisted
session — conflicts with the visibility requirement.

**D2 — The child persists a real session.** Unlike every external
implementation, the child runs **without** `--no-session` and without
`PI_CODING_AGENT_DIR` isolation. Pi writes the session file into the standard
workspace session directory, exactly where
`server/pi-session-store.ts` `listRecentPiSessions` scans. The subagent run
therefore shows up in recent sessions (title = first 8 words of the task, via
`fallbackSessionTitle`) and opens in the ordinary conversation view with the
full transcript, tool calls, and costs. Debugging a subagent is opening a
session.

**D3 — Live progress through the existing tool-update path.** The tool
streams child activity (current step, tool count vs budget, elapsed time) via
`onUpdate`. Livecraft already renders `tool_execution_update` in the parent's
tool call card, so the live view is the card itself — zero UI work in v1.

**D4 — One agent definition in code, in the repo.** V1 ships exactly one
agent: the research assistant, defined as constants in the new extension. No
agent-file discovery, no catalogs. The definition layer (markdown + frontmatter
files) is a future step once a second subagent exists.

**D5 — Effort presets are the caller's contract.** Every call carries
`effort: quick | standard | deep`, mapping to a timeout plus soft/hard
tool-call budgets enforced by `budget-guard` (soft target = stop expanding and
synthesize; hard ceiling = calls blocked, child must synthesize). The tool
description states the wall-time and scope expectations for each effort so the
caller model sets correct expectations. Per-call `timeoutMs` and `model`
overrides remain available.

**D6 — Capability comes from loaded extensions, not new tools.** The child
loads the fff extension (`fffind`/`ffgrep`, tools-only mode) and the installed
search extension (`pi-gpt-search`, `codex-research`/`codex-search`) plus
`read`. Vision is pi-native: an optional image path is passed as `@<path>` in
the prompt (the `analyze_image` mechanism). No tool is written for images or
search in this project.

**D7 — Ownership boundary is unchanged.** Children are one-shot non-RPC
processes spawned by the extension inside the parent's Pi process — the same
class of run `repo_explore_ff` already performs. `server/manager.ts` remains
the sole owner of `pi --mode rpc` processes; the backend gains no routes; the
frontend gains no state. A manager restart closes the parent Pi; the detached
child keeps running and its session file survives — the parent tool call is
lost with the parent session, which v1 accepts.

## Tool contract

```
research(task, effort?, image?, cwd?, model?, timeoutMs?) → research brief
```

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `task` | string | required | What to find, summarize, or research. Becomes the child session title. |
| `effort` | `quick` \| `standard` \| `deep` | `standard` | Preset below; overridable by setting. |
| `image` | string | — | Path to a screenshot/image (relative to workspace). Passed as `@path` so a vision model reads it. |
| `cwd` | string | workspace | Directory the child runs in and persists its session under. |
| `model` | string | setting | Model override for this call. |
| `timeoutMs` | number | preset | Per-call timeout override. |

Default presets (tunable via settings):

| Effort | Timeout | Tool calls (soft/hard) | Expected use |
|---|---|---|---|
| `quick` | 45 s | 6 / 8 | A known file/symbol lookup, a one-page summary, a single image analysis. |
| `standard` | 120 s | 12 / 16 | Map one feature across files; a focused web search with sources. |
| `deep` | 480 s | 24 / 32 | Multi-angle research, cross-referenced repo + web audits, long synthesis. |

Settings (existing extension-settings mechanism, same shape as
`repo-explore-ff` today): model, thinking level (default `off`), default
effort, timeout override, max output chars (default 30 000), fff extension
path, search extension path, pi executable.

System prompt: the research brief discipline — direct answer first; findings
with sources (URLs, or `file:line` for repo evidence); explicit confidence and
contradictions; short next steps; no file edits, no side effects. The effort
preset's guidance and budget are appended per call, as `repo_explore_ff` did.

On timeout or cancel, completed tool evidence collected so far is returned as
partial output (the `repo_explore_ff` recovery pattern), and the child's
session file remains for inspection.

## What is visible where

| Surface | Behavior |
|---|---|
| Parent tool card | Live: streaming progress line (step, tool count vs budget, elapsed). |
| Recent sessions | The child session appears like any session (title from task, workspace session dir). |
| Conversation view | Full child transcript, tool calls, and costs; openable during and after the run. |
| Manager list | Not listed — the child is not a managed RPC session (v1). |

Not built in v1: nesting the child under the parent in the session list,
live child transcript inside the parent card beyond the progress line,
background/async runs, parallel or chained subagents.

## Task plan

1. **Port `budget-guard` into the repo** as `pi-extensions/budget-guard.ts`
   (source exists in the user-level backup), with env-driven soft/hard budgets.
   Focused test.
2. **Write `pi-extensions/research.ts`**: the `research` tool plus child
   runner — argument assembly, JSON event parsing (turns, tool counts, usage,
   final text), progress throttling, timeout/abort with partial-evidence
   recovery, output cap. Reuse the runner structure from the
   `repo-explore-ff` backup; change only what D2 requires (session
   persistence, image path, search tools). Focused tests for argument
   assembly and event extraction.
3. **Register in `server/pi-process.ts`** persistent-session arguments.
4. **Declare settings** for model/effort/timeout/paths through the extension
   settings mechanism.
5. **Retire the old tools**: remove the user-level `repo-explore-ff` and
   `image-analysis` extensions and their settings after the replacement is
   verified. This deletes files outside the repo — do it only with the
   user's explicit go-ahead.
6. **Validation**: `npm run typecheck`, `npm run lint`, focused tests; one
   manual end-to-end call verified in the running app (live card + child
   session visible in recent sessions) via the livecraft-browser skill.

## Future (not in this version)

- Agent-definition files (markdown + frontmatter) once a second subagent is
  needed; recursion bounded by an explicit allowlist (pi-agents' `delegate:`
  pattern).
- Session-list grouping of subagent sessions under their parent session.
- Streaming the child's transcript into the parent card beyond one progress
  line.
- Background subagents with status polling.
