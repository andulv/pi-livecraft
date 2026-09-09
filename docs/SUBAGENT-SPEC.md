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

Every run persists a real Pi session file so it can be debugged and its cost
accounted for. The default surface is the parent's **tool call card** with live
progress; the card also opens the child session in the ordinary conversation
view on demand. No new endpoints, no manager changes, no protocol changes.

## Requirements

- One tool, `research`, with a task plus effort control; quick calls land in
  1–30 s, deep research may run for minutes.
- The calling model must understand, from the tool description alone, what each
  effort costs in wall time and scope, and be able to pick deliberately.
- Live view of what the subagent is doing in the tool card, and a full
  transcript openable in the ordinary session view for debugging.
- Every run leaves a persisted, identifiable record: transcript, tool calls and
  usage, so spend can be analyzed after the fact.
- Vision input (screenshots/images) without a separate image tool.
- Read-only in v1, but structured so later profiles can add temp files, report
  writing, or shell access by changing one capability declaration.
- Retire `repo_explore_ff` and `analyze_image` without losing their strengths:
  effort budgets, timeout with partial-evidence recovery, model/effort
  settings.

## Prior art

| Source | Mechanism | Lesson taken |
|---|---|---|
| [Official example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/) | `pi --mode json -p --no-session` subprocess; agents as markdown + frontmatter | Agent definition layer; usage tracking; launcher resolution |
| [pi-subagents](https://github.com/nicobailon/pi-subagents) | In-process SDK sessions, foreground + background | `researcher` agent brief format; model-tier expectations |
| [pi-agents](https://github.com/sebastienservouze/pi-agents) | In-process SDK sessions with `SessionManager.inMemory()` | `delegate:` allowlist gate; prompt composition. Rejected as mechanism for the reasons in D1 — note that in-process runs *could* persist (`SessionManager.create(cwd)`, `docs/sdk.md`); that is not why it is rejected |
| `repo_explore_ff` + `budget-guard` (this project's own tool, at `../pi-extensions/repo-explore-ff/`) | One-shot `pi --mode json --print` subprocess | Effort presets with soft/hard tool-call budgets; partial-evidence recovery on timeout — kept as the core |

## Design decisions

**D1 — Subprocess child, not in-process.** The tool spawns a one-shot
`pi --mode json --print` child in its own process group. This matches the
existing `repo_explore_ff`/`analyze_image` precedent, keeps children killable
on cancel, isolates crashes and memory from the parent Pi process, and avoids
coupling the extension to SDK internals. An in-process SDK child could also
persist a session; it is rejected for isolation and cancellation, not for
visibility.

**D2 — The child persists a real, marked session.** The child runs **without**
`--no-session` and without `PI_CODING_AGENT_DIR` isolation, so Pi writes the
session file into the standard workspace session directory that
`server/pi-session-store.ts` `listRecentPiSessions` scans. This holds for every
effort, including `quick`: the persisted transcript is the debugging and
cost-accounting record.

The child is named at startup with `--name "subagent/research: <task>"`. The
prefix is the marker: without it a subagent run is indistinguishable from a
user session in the recent list, which blocks both filtering and any later
parent/child grouping. Titles otherwise fall back to `fallbackSessionTitle`,
which cannot express origin.

**D3 — The tool card is the default surface; the session view is on demand.**
The tool streams child activity (current step, tool count vs budget, elapsed,
tokens) via `onUpdate`; Livecraft already renders `tool_execution_update` in
the parent's card (`src/features/conversation/tool-protocol.ts:142,163` →
`ToolCallCard.tsx:103-108`). The child's session id and file path — the id
comes from the first stdout line, the JSON session header (`docs/json.md`) —
are reported in the first progress update and in the final result, so a
tool-call presentation can offer **Open subagent session**, reusing the
existing `openSession(cwd, sessionPath)` path.

Consequence to accept: Livecraft has no read-only session viewer. Opening a
past session resumes it live through `server/manager.ts` (`POST /api/sessions`
with `sessionPath`, `backend.ts:565-580`). Opening a subagent session therefore
spawns a Pi process and turns that run into an ordinary, continuable session.
That is acceptable — and useful for continuing a research thread by hand — but
it is not a passive inspection.

**D4 — Subagent sessions are filtered out of the recent list by default.**
`repo_explore_ff` is called constantly; unfiltered, every run would sort to the
top of a list that keeps only the newest 60 scanned and top 30 returned, and
would push real sessions out. `sidebarSessions`
(`src/features/workspace/sidebar-sessions.ts`) drops sessions whose name starts
with the `subagent/` prefix unless a **Show subagent sessions** toggle is on,
mirroring the existing "Show archived items" control in
`WorkspaceSidebar.tsx`. The tool card link remains the primary route in.

**D5 — One agent profile in code, shaped for more later.** V1 ships exactly one
profile — the research assistant — as a constant in the new extension holding
its model defaults, `--tools` allowlist, extension list, and system prompt.
Adding a writing or shell-capable profile later means adding a second constant
and a `profile` parameter, not restructuring the runner. No agent-file
discovery, no catalogs, no recursion in v1.

**D6 — Effort presets are the caller's contract.** Every call carries
`effort: quick | standard | deep`, mapping to a timeout plus soft/hard
tool-call budgets enforced by `budget-guard` (soft target = stop expanding and
synthesize; hard ceiling = calls blocked, child must synthesize). The tool
description states wall-time and scope expectations per effort so the calling
model picks deliberately. Per-call `timeoutMs` and `model` overrides remain.

Honest limitation: a blocking tool call gives the *calling model* no mid-flight
status — progress updates reach the UI, not the model. So the caller's control
is entirely up-front: effort, timeout, and a description precise enough to
choose correctly. Background runs with a polling tool are deferred (Future).

**D7 — Read-only is enforced by argv, not by prompt wording.** The child runs
with `--no-extensions` plus an explicit `--extension` list and a `--tools`
allowlist containing only read tools. `--no-extensions` is also the recursion
and configuration guard: without it the child inherits the user's global
extension list from `~/.pi/agent/settings.json`.

**D8 — Cancel kills the child immediately.** On parent abort (`signal`) or
timeout, the child's process group is terminated at once, evidence collected so
far is returned as partial output (the `repo_explore_ff` recovery pattern), and
the session file remains for inspection. Orphaned children are only accepted
for a manager restart, which closes the parent Pi and loses the tool call
anyway.

**D9 — Ownership boundary is unchanged.** Children are one-shot non-RPC
processes spawned by the extension inside the parent's Pi process — the same
class of run `repo_explore_ff` already performs. `server/manager.ts` remains
the sole owner of `pi --mode rpc` processes; the backend gains no routes; the
frontend gains one tool-call presentation and one list filter.

## Tool contract

```
research(task, effort?, images?, cwd?, model?, timeoutMs?) → research brief
```

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `task` | string | required | What to find, summarize, or research. Also forms the child session name. |
| `effort` | `quick` \| `standard` \| `deep` | `standard` | Preset below; default overridable by setting. |
| `images` | string[] | — | Paths to screenshots/images (relative to `cwd`). Passed as `@path` arguments so a vision model reads them. |
| `cwd` | string | workspace | Directory the child runs in and persists its session under. |
| `model` | string | setting | Model override for this call. |
| `timeoutMs` | number | preset | Per-call timeout override. |

Default presets (tunable via settings):

| Effort | Timeout | Tool calls (soft/hard) | Expected use |
|---|---|---|---|
| `quick` | 45 s | 6 / 8 | A known file/symbol lookup, a one-page summary, a single image analysis. |
| `standard` | 120 s | 12 / 16 | Map one feature across files; a focused web search with sources. |
| `deep` | 480 s | 24 / 32 | Multi-angle research, cross-referenced repo + web audits, long synthesis. |

Result: the research brief, preceded by a one-line run header with child
session id, effort, elapsed time, tool calls used vs budget, and tokens/cost.
Child usage is **not** part of the parent session's stats or the quota widget;
the header and the persisted child session are how subagent spend is seen.

### Child invocation

```
pi --no-extensions --no-skills --no-prompt-templates --no-themes
   --mode json
   --name "subagent/research: <task, truncated>"
   --extension <fff extension> --extension <budget-guard> --extension npm:pi-gpt-search
   --fff-mode tools-only
   --tools fffind,ffgrep,read,codex-research,codex-search
   --system-prompt <profile prompt + effort guidance + budgets>
   [--model <model>] --thinking <level>
   --print "<@image ...> <task>"
```

Deliberate differences from `repo_explore_ff`'s argv
(`../pi-extensions/repo-explore-ff/index.ts:369-412`): no `--no-session` (D2),
`--name` added (D2), search extension and its tools added (D5), images
appended to the prompt as `@path` (the `analyze_image` mechanism,
`../pi-extensions/image-analysis/index.ts:151-165`).

`--no-context-files` is **not** passed: the workspace `AGENTS.md` is cheap
context that improves repo answers. Note that non-interactive modes never
prompt for trust and fall back to `defaultProjectTrust`
(`docs/security.md` in the installed Pi docs), so project-level resources may
be ignored unless the workspace is already trusted; v1 does not pass `-a`.

Settings (existing extension-settings mechanism, same shape as
`repo-explore-ff` today): model, thinking level (default `off`), default
effort, timeout override, max output chars (default 30 000), fff extension
path, search extension path, pi executable.

System prompt: the research brief discipline — direct answer first; findings
with sources (URLs, or `file:line` for repo evidence); explicit confidence and
contradictions; short next steps; no file edits, no side effects. The effort
preset's guidance and budget are appended per call, as `repo_explore_ff` did.

## What is visible where

| Surface | Behavior |
|---|---|
| Parent tool card | Default view. Live progress line (step, tool count vs budget, elapsed, tokens) and an **Open subagent session** action. |
| Conversation view | Full child transcript, tool calls and costs, opened from the card. Opening resumes the session live (D3). |
| Recent sessions | Hidden behind the **Show subagent sessions** toggle; identified by the `subagent/` name prefix. |
| Manager list | Listed only if the user opens the child session, at which point it is an ordinary session. |
| Quota / session analysis widgets | Unchanged; they do not aggregate child spend in v1. |

Not built in v1: nesting the child under the parent in the session list,
cross-session cost aggregation, streaming the child's transcript into the
parent card beyond the progress line, background/async runs, parallel or
chained subagents, a read-only session viewer.

## Task plan

1. **Port the extension helpers into this repo**: `budget-guard` as
   `pi-extensions/budget-guard.ts`, and the settings helper that
   `repo-explore-ff` imports from `../pi-extensions/shared/extension-config.ts`
   (`publishExtensionSettings`, `effectiveSettings`, value accessors) — no
   equivalent exists in `shared/` today. Focused test for the budget guard.
2. **Write `pi-extensions/research.ts`**: the `research` tool, the research
   profile constant (D5), and the child runner — argument assembly, JSON event
   parsing (session header id, turns, tool counts, usage, final text), progress
   throttling, cancel/timeout with immediate process-group kill and
   partial-evidence recovery, output cap. Reuse the runner structure from
   `repo-explore-ff`; change only what D2/D5/D7/D8 require. Focused tests for
   argument assembly, session-id extraction, and event extraction, following
   `test/ask-user-question.test.ts` as the pi-extension test pattern.
3. **Register in `server/pi-process.ts`** persistent-session arguments.
4. **Declare settings** for model/effort/timeout/paths through the extension
   settings mechanism.
5. **Frontend, minimal**: a tool-call presentation
   (`docs/HOW-TO-TOOL-PRESENTATION.md`) exposing the **Open subagent session**
   action, and the `subagent/` filter plus toggle in
   `src/features/workspace/sidebar-sessions.ts` / `WorkspaceSidebar.tsx`.
6. **Retire the old tools**: remove the `repo-explore-ff` and `image-analysis`
   extensions and their settings after the replacement is verified, and update
   `AGENTS.md` tool-discipline wording plus any doc or skill referencing
   `repo_explore_ff` / `analyze_image`. This deletes files outside the repo —
   do it only with the user's explicit go-ahead.
7. **Validation**: `npm run typecheck`, `npm run lint`, focused tests; one
   manual end-to-end call verified in the running app (live card, open-session
   action, filtered recent list) via the livecraft-browser skill.

## Future (not in this version)

- Additional profiles: temp-file scratch space, report writing, shell access —
  added as capability declarations on the profile constant (D5).
- Background subagents with a status/poll tool, so a calling model can abandon
  a long run (the gap named in D6).
- Cross-session cost aggregation, so subagent spend appears in the session
  analysis widget.
- Session-list grouping of subagent sessions under their parent session.
- Agent-definition files (markdown + frontmatter) once profiles outgrow code;
  recursion bounded by an explicit allowlist (pi-agents' `delegate:` pattern).
