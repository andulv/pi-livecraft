# Subagent sessions specification

The design record for subagents in Pi Livecraft. The first version described
here is implemented: `pi-extensions/research.ts` owns the tool and the agent
profile, `pi-extensions/subagent-child.ts` runs the child, and the parent's tool
call card carries live progress plus an action that opens the child session.

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

- One tool, `research`, with a task plus effort control; quick calls normally
  land in 15–45 s, deep research may run for minutes.
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

The child is named at startup with
`--name "subagent/<owner-session-id>/research: <task>"`. The prefix and owner
marker are the persisted relationship: without them a subagent run is
indistinguishable from a user session in the recent list, which blocks both
filtering and parent/child grouping. The session store hides the owner marker
from the displayed child title.

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
Frequent research runs must not crowd ordinary sessions out. The backend scans
metadata in batches until it has 60 ordinary candidates (or exhausts the
workspace), returning up to 30 ordinary sessions and 30 subagent sessions with
separate budgets. Child names persist the owner id as
`subagent/<owner-session-id>/research: <task>`; the session store exposes that
owner separately and hides the marker from the display name.

`sidebarSessions` (`src/features/workspace/sidebar-sessions.ts`) excludes
subagents by default. **Include subagent sessions** opts into children whose
owner is present in the ordinary workspace list, inserting each child directly
beneath its owner. The sidebar renders those rows indented with a branch
connector and a child marker, so ownership is visually explicit. Unowned
children, children from another workspace, and children whose owner is hidden
or absent are not included. The tool card link remains the primary route in.
Recognition and ownership are name-based in v1: manually renaming a child
without the marker loses its grouping metadata; older unmarked runs cannot be
identified reliably.

**D5 — One agent profile in code, shaped for more later.** V1 ships exactly one
profile — the research assistant — as constants in the extension holding its
model defaults, `--tools` allowlist, extension list, and system prompt. The
runner is reusable, but profile selection is not a config feature yet: adding a
writing or shell-capable profile currently requires code for the profile and a
new tool parameter or registration. No agent-file discovery, catalogs, or
recursion in v1.

**D6 — Effort presets are the caller's contract.** Every call carries
`effort: quick | standard | deep`, mapping to a timeout plus soft/hard
tool-call budgets enforced by `subagent-budget-guard.ts` (soft target = stop
expanding and synthesize; hard ceiling = calls blocked, child must synthesize).
The tool description states wall-time and scope expectations per effort so the
calling model picks deliberately. Per-call `timeoutMs` and `model` overrides
remain.

The timeouts are ceilings measured against the configured model, not targets: a
four-call `quick` run on `glm-5.3-flash` took about 50 s, so the quick ceiling
is 90 s rather than the 45 s `repo_explore_ff` used with a faster, text-only
model.

Honest limitation: a blocking tool call gives the *calling model* no mid-flight
status — progress updates reach the UI, not the model. So the caller's control
is entirely up-front: effort, timeout, and a description precise enough to
choose correctly. Background runs with a polling tool are deferred (Future).

**D7 — Capability is declared in the profile and enforced by argv.** The child
runs with `--no-extensions` plus an explicit `--extension` list and a `--tools`
allowlist. `--no-extensions` is also the recursion and configuration guard:
without it the child inherits the user's global extension list from
`~/.pi/agent/settings.json`, including this extension.

The allowlist is `fffind, ffgrep, read, bash`. `bash` is present because the
internet transport is the `ketch` CLI, not a search extension; the prompt
restricts it to `ketch`. No file-mutating tool is in the allowlist, so `edit`,
`write`, and `apply_patch` are unavailable regardless of what the prompt says.
This is not a read-only sandbox: bash can mutate files or run arbitrary commands.
Both "read-only" and "shell only for search" depend on prompt discipline. Later
profiles widen the allowlist rather than the mechanism.

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

Default model: `openrouter/z-ai/glm-5.3-flash` — vision-capable, 1M context, and
cheap enough that a bounded run costs fractions of a cent.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `task` | string | required | What to find, summarize, or research. Also forms the child session name. |
| `effort` | `quick` \| `standard` \| `deep` | `standard` | Preset below; default overridable by setting. |
| `images` | string[] | — | Paths to screenshots/images (relative to `cwd`). Passed as `@path` arguments so a vision model reads them. |
| `cwd` | string | workspace | Directory the child runs in and persists its session under. |
| `model` | string | setting | Model override for this call. |
| `timeoutMs` | number | preset | Per-call timeout override. |

Default presets (tunable via settings):

| Effort | Timeout ceiling | Tool calls (soft/hard) | Expected use |
|---|---|---|---|
| `quick` | 90 s | 6 / 8 | A known file/symbol lookup, a one-page summary, a single image analysis. |
| `standard` | 240 s | 12 / 16 | Map one feature across files; a focused web search with sources. |
| `deep` | 600 s | 24 / 32 | Multi-angle research, cross-referenced repo + web audits, long synthesis. |

Result: the research brief, preceded by a one-line run header with effort,
elapsed time, tool calls used, tokens, cost, and the child session file.

Cost accounting decision: per call and per session only. The header reports what
one call cost, and the persisted child session holds the authoritative record
for later analysis, but nothing aggregates subagent spend into the parent's
stats or the quota widget. That answers "what did this call cost" and "what has
this run spent" by inspection. If totals across many runs become a real
question, the session-analysis widget is where to add them (Future), because it
already aggregates per-turn cost.

### Child invocation

```
pi --no-extensions --no-skills --no-prompt-templates --no-themes
   --mode json
   --name "subagent/<owner-session-id>/research: <task, truncated>"
   --extension <fff extension> --extension <subagent-budget-guard>
   --fff-mode tools-only
   --tools fffind,ffgrep,read,bash
   --system-prompt <profile prompt + effort guidance + budgets>
   [--model <model>] --thinking <level>
   --print "<@image ...> <task>"
```

Deliberate differences from `repo_explore_ff`'s argv: no `--no-session` (D2),
`--name` added (D2), `bash` in the allowlist for `ketch` (D7), images appended
to the prompt as `@path` (the `analyze_image` mechanism). The tool-call budget
reaches the child through `PI_SUBAGENT_SOFT_TOOL_CALLS` and
`PI_SUBAGENT_HARD_TOOL_CALLS`.

No search extension is loaded: the `ketch` CLI covers search, scraping, code,
and documentation lookup through one transport, so the child needs no extension
for it. Skills are disabled and the ketch usage a skill would supply is stated
directly in the profile prompt instead — loading a skill alongside `--no-skills`
could not be verified, and inlining removes the ambiguity.

`--no-context-files` is **not** passed: the workspace `AGENTS.md` is cheap
context that improves repo answers. Note that non-interactive modes never
prompt for trust and fall back to `defaultProjectTrust`
(`docs/security.md` in the installed Pi docs), so project-level resources may
be ignored unless the workspace is already trusted; this version does not pass
`-a`.

Settings (existing extension-settings mechanism, same shape as
`repo-explore-ff` today): model, thinking level (default `off`), default
effort, timeout override, max output chars (default 30 000), fff extension
path, pi executable.

System prompt: the research brief discipline — direct answer first; findings
with sources (URLs, or `file:line` for repo evidence); explicit confidence and
contradictions; short next steps; no file edits, no side effects. The effort
preset's guidance and budget are appended per call, as `repo_explore_ff` did.

## What is visible where

| Surface | Behavior |
|---|---|
| Parent tool card | Default view. Live progress line (current tool, count vs budget) and an **Open subagent session** action once the run has a session. |
| Conversation view | Full child transcript, tool calls and costs, opened from the card. Opening resumes the session live (D3). |
| Recent sessions | Excluded from the ordinary list; **Include subagent sessions** inserts owned children beneath their visible owner, identified by the `subagent/` name marker. |
| Manager list | Listed only if the user opens the child session, at which point it is an ordinary session. |
| Quota / session analysis widgets | Unchanged; they do not aggregate child spend. |

Not built in v1: cross-session cost aggregation, streaming the child's
transcript into the parent card beyond the progress line, background/async runs,
parallel or chained subagents, and a read-only session viewer.

## Implementation

| File | Role |
|---|---|
| `pi-extensions/research.ts` | Tool contract, research profile, effort presets, published settings. |
| `pi-extensions/subagent-child.ts` | Child argv, JSON event stream, progress, cancel/timeout, session-file lookup. |
| `pi-extensions/subagent-budget-guard.ts` | Hard tool-call ceiling inside the child. |
| `pi-extensions/extension-settings-store.ts` | Extension-side publishing and per-call resolution of settings. |
| `shared/subagent-session.ts` | The `subagent/` naming rule, shared by producer and session list. |
| `shared/pi-session-paths.ts` | Workspace session folder rule, shared with `server/pi-session-store.ts`. |
| `server/pi-process.ts` | Loads the extension into persistent sessions. |
| `src/features/conversation/OpenSubagentSessionButton.tsx` | Opens the child session from the tool card. |
| `src/features/workspace/sidebar-sessions.ts` | Filters subagent runs by default and groups owned children beneath visible owners when enabled. |

The child session file is located from the parent's own session file
(`ctx.sessionManager.getSessionFile()`) plus the workspace folder rule, which is
the one place the storage root is known without duplicating Pi's environment
resolution.

Tests: `test/subagent-child.test.ts` (argv assembly, event extraction, progress)
and the subagent case in `test/sidebar-sessions.test.ts`.

Remaining work:

1. **Retire the old tools**: remove the `repo-explore-ff` and `image-analysis`
   extensions and their settings once the replacement has proved itself, and
   update `AGENTS.md` tool-discipline wording plus any doc or skill referencing
   `repo_explore_ff` / `analyze_image`. This deletes files outside the repo, so
   it needs an explicit go-ahead. `image-analysis` is cleared to go;
   `repo_explore_ff` stays until the research subagent is confirmed in daily
   use.
2. **Close the debug-link gap**: the current card action is available only after
   a successful result, not during a live run or after timeout/cancellation.
   Those runs still persist and can be opened through the Subagents list.
   The spec's early session-path updates remain unimplemented.

## Future (not in this version)

- Additional profiles: temp-file scratch space, report writing, wider shell
  access — added as capability declarations on the profile constant (D5).
- Background subagents with a status/poll tool, so a calling model can abandon
  a long run (the gap named in D6).
- Cross-session cost aggregation, so subagent spend appears in the session
  analysis widget.
- More robust persisted ownership metadata than the v1 name marker, including
  resilience to child renames.
- Agent-definition files (markdown + frontmatter) once profiles outgrow code;
  recursion bounded by an explicit allowlist (pi-agents' `delegate:` pattern).
