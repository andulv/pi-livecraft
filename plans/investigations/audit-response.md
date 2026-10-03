# Audit Response & Improvement Plan

Response to [`audit-notes.md`](audit-notes.md). For each audit finding this document records a
verdict (**agree** / **partially agree** / **disagree**) and, where I agree, a concrete
implementation task-list with the owning files and the validation that proves the change.

## How I evaluated the audit

I did not take the audit on faith. I spot-checked ~20 of its concrete claims against source and
every one held up exactly as written:

- `alt+2` is assigned to **both** `open-thinking` and `focus-composer` in
  `src/features/commands/command-registry.ts:61,71` — a real dead-binding bug.
- `isModelBody` (`server/backend.ts:940`) and `isModelOption` (`server/manager.ts:528`) are the
  same predicate in two layers.
- `ManagerRuntimeMonitor.#refreshExpectedRevision` calls `calculateManagerRuntimeRevision()` twice
  (`server/manager-runtime-monitor.ts:98,102`); the first `revision` is discarded.
- `isImageContent` is defined twice (`MessageCard.tsx:254`, `message-display.ts:80`).
- Stringly-typed titles confirmed: `'Select an agent'` (`dialog-protocol.ts:46`),
  `'Pi Livecraft questionnaire'` (`dialog-protocol.ts:36` + `ask-user-question.ts:15`).
- French strings confirmed: `↘ N car.` (`ToolCallCard.tsx:251,260`), the entire
  `buildSessionAnalysisPrompt` (`session-analysis.ts:383,391`), and `// ponytail:` markers
  (`server/jsonl.ts:5`, `GitWidget.tsx:104`).
- Silent error swallowing confirmed: initial quota/environment loads
  (`App.tsx` `.catch(() => undefined)`), the backend route catch that never logs
  (`backend.ts:111`), `handleRequest`'s catch that responds but never logs (`manager.ts:151`),
  `reuseSession`'s bare `catch {}` that drops the cause (`manager.ts:433`), and the five inline
  error-class mappers in `backend.ts`.
- `refreshGit(cwd, notifyOnError)` (`App.tsx:718`) actually *rethrows* when the flag is set — the
  name is misleading, as claimed.

The audit is accurate and fair. My disagreements below are not about facts; they are about whether
a proposed *deletion* trades away a real capability, or whether a decision belongs to the product
owner rather than a refactor pass.

## Verdict summary

| # | Finding | Verdict | Priority |
|---|---|---|---|
| 1 | Error surfacing inconsistent | **Agree** | High |
| 2 | Hand-written validators duplicate types | **Partially agree** (dedupe the identical pair; skip a new framework) | Low |
| 3 | App.tsx size/composition | **Partially agree** (extract mechanical blocks; keep toast state in App) | Medium |
| 4 | App.tsx misleading `notifyOnError` | **Agree** | Low |
| 5 | `createOrderedSender` over-abstraction; `inflightGet` | **Partially agree** (warn on drop; keep the cache) | Low |
| 6 | Backend route boilerplate + unlogged 500s + lost cause | **Agree** | Medium |
| 7 | Manager session reuse; double-revision; dup action list | **Partially agree** (fix the small bugs; do **not** delete reuse blind) | Mixed |
| 8 | Conversation dedupe + partial-JSON parser | **Partially agree** (dedupe now; parser is a product decision) | Medium |
| 9 | Composer dropdown + cross-provider price heuristics | **Partially agree** (drop price matching; defer Radix rewrite) | Medium |
| 10 | `useDismissableMenu` + `usePanelResize` hooks | **Agree** | Medium |
| 11 | Quotas "prompt as RPC" + ZCode fragility | **Partially agree** (add a health log; accept the rest) | Low |
| 12 | BrowserView `.catch(() => {})` cluster | **Agree** (rides §1) | Medium |
| 13 | Stringly-typed coupling to Pi extension UI | **Agree in principle** (gated on a protocol check) | Medium |
| 16/17 | Low-value tests + multi-model artifacts | **Agree** (targeted) | Low |
| 7 | Drop session reuse entirely | **Disagree** (measure first) | — |
| 8 | Delete partial-tool-args streaming | **Disagree** (product decision) | — |
| 9 | Rewrite ModelSelect onto Radix | **Disagree for now** (large, low payoff) | — |
| 14/17 | Remove legacy storage migrations | **Defer** (bundle into a storage-version bump) | — |

---

# Agreed work — implementation specs

Ordered by leverage. Each item is independently shippable.

## A. Shared error policy (§1, §4, §6, §12) — High

**Rationale.** Three error regimes coexist and the server logs nothing on unexpected failure, so a
reported UI glitch cannot be diagnosed from logs. This is the highest-diagnosability-per-line change
in the audit and I agree fully.

### A1. Log unexpected errors server-side before responding
- **Files:** `server/backend.ts` (route catch, `backend.ts:111`), `server/manager.ts`
  (`handleRequest` catch `manager.ts:151`; `reuseSession` catch `manager.ts:433`).
- **Tasks:**
  1. In the backend `route().catch`, when `error` is **not** an `HttpError`, `console.error` it
     (method + path + `errorMessage`) before sending the 500.
  2. In `handleRequest`'s catch, `console.error` the action + `errorMessage` before responding
     `ok:false` (keep the response unchanged).
  3. In `reuseSession`'s `catch {}`, capture the cause and `console.error` it (the session still
     terminates and returns `false`; only the silence changes).
  4. In `navigate`/`dispatchInput` (`backend.ts:698,716`): only map to the `409 'not live'` message
     when the session is genuinely not live; otherwise include `errorMessage(error)` so a real CDP
     fault is not misdiagnosed. (This is the §6 "lost cause" item.)
- **Validation:** `npm run lint`; `npm run typecheck`; targeted `npm test -- test/manager.integration.test.ts`
  if reuse/handleRequest paths are touched (guarded — may skip without `pi`).

### A2. Frontend global safety net
- **Files:** new small module in `src/features/notifications/`, wired from `src/App.tsx`.
- **Tasks:**
  1. Add a React error boundary around the app tree that renders a dismissible error surface
     instead of a blank page.
  2. Add `window.addEventListener('unhandledrejection'|'error', …)` that routes into the existing
     toast system (the notifications README keeps toast *state* in `App.tsx`; the listener publishes
     through the same channel, it does not create a parallel store).
- **Validation:** `npm run build`; manual smoke via the livecraft-browser skill (throw in a child to
  confirm the boundary renders, not a blank page).

### A3. Make background refreshes non-silent
- **Files:** `src/App.tsx` (initial quota/environment loads + the two inside `handleManagerPiEvent`),
  `src/features/workspace/useProjects.ts:21`, `src/api.ts` `parseManagerEvent`.
- **Tasks:** Replace `.catch(() => undefined)` / `.catch(() => [])` on background refreshes with at
  least `console.warn`, and surface a toast where a widget would otherwise stay empty forever.
  Leave the two *documented* stream-status cases (`sendBrowserInput`, `resizeTerminal`) as-is but
  add a code comment pointing at the stream that carries their errors.
- **Validation:** `npm run lint`; `npm run typecheck`.

### A4. Rename the misleading `refreshGit` flag (§4)
- **File:** `src/App.tsx:718` and its callers.
- **Task:** Rename `notifyOnError` → `rethrowOnError` (it rethrows; the *caller* toasts). Update the
  JSDoc to match.
- **Validation:** `npm run typecheck`.

### A5. BrowserView error cluster (§12)
- **File:** `src/features/browser/BrowserView.tsx` (`.catch(() => {})` at 133, 147, 200, 252, 255).
- **Task:** A failed address-bar navigation must not be silent — route the failure onto the browser
  stream status or a toast. Keep clipboard best-effort.
- **Validation:** `npm run build`; browser skill smoke on a bad URL.

---

## B. Fix the `alt+2` shortcut conflict + regression test (§16, §17) — High-value, tiny

**Rationale.** `focus-composer`'s default binding is dead because the keydown handler picks the first
match and `open-thinking` wins. The suite even *has* `shortcutConflicts()` but never runs it on the
defaults; instead `shortcuts.test.ts` pins the conflicting values as "correct". I agree completely.

- **Files:** `src/features/commands/command-registry.ts` (`defaultShortcuts`), `test/shortcuts.test.ts`.
- **Tasks:**
  1. Reassign `focus-composer` to a free key (audit-free candidates: nothing uses `alt+f`; confirm
     against the full `defaultShortcuts` map before choosing).
  2. Replace the brittle "exact default strings" test with an invariant test:
     `assert.equal(shortcutConflicts(defaultShortcuts).size, 0)`. This catches the whole class and
     survives intentional rebalances.
- **Validation:** `npm test -- test/shortcuts.test.ts`.

---

## C. `useDismissableMenu` + `usePanelResize` hooks (§10) — Medium

**Rationale.** Confirmed: four near-identical pointerdown/Escape/focus-restore effects in
`WorkspaceSidebar.tsx` (~230–320) plus a fifth variant in Composer slash commands; and three
hand-rolled `startResize/resize/stop` implementations (`WorkspaceSidebar.tsx:395`,
`RightSidebar.tsx:96`, `FileContentPane.tsx:109`). Pure copy-paste with a keep-in-sync tax. Clean,
low-risk DRY win.

- **Files:** new hooks under `src/features/` (smallest shared owner — likely `src/components/` since
  three features consume them; confirm against `src/components/README.md` before placing).
- **Tasks:**
  1. `useDismissableMenu(ref, open, onClose)` — encapsulate the pointerdown-outside + Escape +
     focus-restore effect. Replace the four WorkspaceSidebar copies; evaluate the Composer variant
     (it differs slightly — adapt or leave with a note).
  2. `usePanelResize({ axis, min, max, onChange })` returning `startResize` — replace the three
     resizers and fold the three separate clamp helpers into the hook.
- **Validation:** `npm run typecheck`; `npm run build`; browser skill smoke on menu-dismiss + drag
  resize in all three panes (behavior must be identical).

---

## D. Backend route helpers (§6) — Medium

**Rationale.** `if (typeof body.cwd !== 'string') throw new HttpError(400, …)` appears ~12×, and five
inline `catch → HttpError` mappers repeat one shape. A small helper removes ~100–150 lines without
moving any route out of `backend.ts` (the documented contract stays intact).

- **File:** `server/backend.ts`.
- **Tasks:**
  1. Add `requireString(body, 'cwd', 'Working directory is required')` (and reuse for other required
     string fields).
  2. Add an error-class → status table applied around `route`, replacing the `WorkspaceFileError`
     (×3), `VSCodeSettingsError`, `TerminalTemplateError`, and browser-start mappers.
  3. Rename `resolveBrowserWorkspace` (used by *terminal* routes too) to a neutral name
     (`resolveWorkspaceForRoute` or similar) — §17 name-drift.
- **Validation:** `npm run lint`; `npm run typecheck`; `npm run build`. Behavior-preserving; confirm
  a couple of routes still return the same status codes.

---

## E. Kill exact duplicates (§2, §7, §8) — Low, mechanical

**Rationale.** These are literal duplicates with drift risk, cheap to remove.

- **Tasks:**
  1. Collapse `isModelBody`/`isModelOption` into one predicate imported by both layers (or a
     `shared/` helper if the trust boundary needs each side to own its copy — pick one and document).
  2. Remove the redundant first `calculateManagerRuntimeRevision()` call in
     `manager-runtime-monitor.ts:98`. **Check first** whether re-hashing after `#replaceWatchers`
     is a deliberate race guard; if not, compute once and `#replaceWatchers` once. Add a one-line
     comment recording the decision either way.
  3. Deduplicate `isImageContent` (keep one, in `message-display.ts`; import into `MessageCard.tsx`).
  4. Unify the three text-part flatteners (`visibleText`, `toolContentText`, `extractUserText`) —
     **only** after confirming their join/trim rules are truly meant to be identical; if they differ
     intentionally, leave a comment and do not merge.
- **Validation:** `npm run typecheck`; `npm test -- test/tool-calls.test.ts` (or nearest) for the
  conversation helpers.

---

## F. Drop cross-provider price matching (§9) — Low, removes fragility

**Rationale.** `baseModelKey` rewrites `glm-5p2`→`glm-5.2` so a struck-through *reference price* from
a sibling provider can be shown for subscription models. Any id containing digit-`p`-digit is
mutated — a fragile cross-provider join serving cosmetic display. I agree it should go.

- **File:** `src/features/composer/model-select-utils.ts`.
- **Tasks:** Delete the cross-provider struck-through price matching and `baseModelKey`; show cost
  only when Pi reports it; let the existing title-case fallback carry display names. Evaluate whether
  the 33-entry `PROVIDER_NAMES` map still earns its place given the fallback (keep entries only where
  the fallback is wrong).
- **Validation:** `npm run typecheck`; nearest composer/model-select test; browser skill visual check
  that subscription models still render sensibly.

---

## G. Language & marker cleanup (§17) — Low

**Rationale.** Repo rule is English identifiers/comments. Confirmed artifacts.

- **Tasks:**
  1. Remove/reword the two `// ponytail:` markers (`server/jsonl.ts:5`, `GitWidget.tsx:104`) — keep
     the useful content, drop the model-specific prefix.
  2. Translate `↘ N car.` → `char` (or the existing English aria word) in `ToolCallCard.tsx:251,260`
     and the `docs/file-icons-preview.html` samples.
  3. Translate the French comment in `App.tsx` `readShortcuts`.
  4. Convert French test titles to English opportunistically when touching those files (do not do a
     397-title sweep in one commit; it obscures real diffs).
- **Validation:** `npm run format:check -- <paths>`; affected tests still pass by name.

> **The French session-analysis prompt is a product decision, not a cleanup.**
> `buildSessionAnalysisPrompt` instructs the model to answer in French. If that is an intended
> product choice, keep it and add a one-line comment saying so. If it is an artifact, translate it.
> **Do not flip it silently** — confirm with the owner first (§8/§17).

---

## H. Targeted low-value test pruning (§16) — Low

**Rationale.** I agree with the *specific* removals, not a broad cull. The suite is healthy.

- **Tasks:**
  1. `prompt-improvement.test.ts` — drop the five "removed preset → undefined" tests; keep one
     "unknown key → undefined" contract test.
  2. `themes.test.ts` — keep the persistence-validation tests; collapse the branch-exhaustive
     in-memory CRUD tests (~28 → ~8).
  3. `shortcuts.test.ts` — replaced by the invariant test in **B** (do these together).
- **Validation:** `npm test -- test/prompt-improvement.test.ts test/themes.test.ts test/shortcuts.test.ts`.

> `tool-presentation.test.ts` partial-JSON tests and `api-dedupe.test.ts` are **intentionally not
> here** — their fate follows the parser (§8) and cache (§5) product decisions below.

---

## I. Small diagnosability adds (§7, §11) — Low

- **Tasks:**
  1. `parseManagerEvent` (`src/api.ts`) and browser-stream handlers: `console.warn` on dropped
     malformed payloads so stream corruption is diagnosable (per §5).
  2. Deduplicate the manager action list: `isManagerRequest` (validation) and the `tracksActivity`
     expression in `handleRequest` list the same actions in two places (`manager.ts:118`). Extract a
     single `const activityActions` set both consume, so adding an action touches one place (§7).
  3. ZCode credential decryption (`pi-extensions/quotas.ts`): add a health-check `console.warn`/log
     when the decryption path stops resolving, so a silent storage-format change is visible rather
     than hiding reset cards (§11). The rest of the reverse-engineered integrations are accepted
     fragility with exemplary typed-error reporting — no change.
- **Validation:** `npm run lint`; `npm run typecheck`.

---

# Gated — investigate before implementing

## J. Structured field instead of title/ANSI parsing (§13) — needs a protocol check

**Rationale.** Where **both** ends are ours (extension ↔ frontend/manager), identifying protocol
objects by human-facing title strings (`'Select an agent'`, `'Pi Livecraft questionnaire'`) and
parsing an ANSI-formatted `Agent:` field out of `setStatus` text (`activeAgentFromStatus`) is
accidental complexity that silently breaks on a rename. I agree with the direction.

**Blocker:** the fix depends on Pi's public RPC exposing a structured channel (a `customType`
discriminator or a status payload field). Per AGENTS.md I must use the public protocol and must not
inspect internal files to reproduce a capability.

- **Tasks:**
  1. Read `docs/HOW-TO-TALK-TO-PI.md` and the upstream RPC reference it points to; confirm whether a
     structured discriminator field is available on extension UI requests / status reports.
  2. If yes: add a `livecraft:`-namespaced structured field on our extension's side and match on it
     in `dialog-protocol.ts` / `manager.ts`, keeping the title match only as a fallback for one
     release.
  3. If no: leave the title matching, but centralize the magic strings into named constants shared
     by producer and consumer so a rename is a one-line change, and add a comment recording the
     platform constraint.
- **Validation:** `npm test -- test/dialog-protocol.test.ts`; manager integration test for the agent
  path (guarded).

---

# Disagreements & deferrals

## K. Do **not** delete manager session reuse yet (§7) — Disagree

The audit names this the top simplification (~150 lines + tests). I disagree with doing it now.

- It is **documented and intentional** (MANAGER-LIFECYCLE.md); AGENTS.md forbids changing manager
  supervision/restart behavior without explicit approval.
- The tradeoff it buys — a warm process before the first keystroke — is a **product/latency
  decision**, not a code-health defect. The audit itself lists "new-session startup latency" as the
  risk.
- **Correct sequence:** instrument new-session startup latency with and without reuse under a real
  workload; if the ≥3-idle-sessions heuristic no longer pays, delete `reuseSession`,
  `bufferedEvents`, `switching`, and the `session_reassigned` rewrite **as one approved change**.
  Until that data exists, only the *bug fixes* inside §7 (logging the dropped cause — **A1**; the
  double-revision call — **E2**; the duplicated action list — **I2**) should land.

## L. Do **not** delete the partial-tool-args streaming parser (§8) — Disagree (product call)

The hand-written incremental JSON parser (~150 lines) is algorithmically risky, but it powers a
visible feature: partial `command`/`path` in the tool-call header while the model streams. Deleting
it is a **UX regression the product owner should choose**, not a refactor. Recommendation: surface
the decision explicitly (keep-and-document vs. replace-with-"generating tool call…" placeholder). If
cut, the §16 partial-JSON tests go with it. I will not remove it unprompted.

## M. Defer the ModelSelect → Radix rewrite (§9) — Disagree for now

`ModelSelect` (392 lines) duplicates Radix positioning/keyboard work, but it is working, tested UI
with grouping/favorites/search that a naive Radix swap could regress. High effort, cosmetic payoff,
real regression surface. Revisit only if we touch that dropdown for a feature reason.

## N. Keep toast state in App.tsx (§3) — Partially disagree

The notifications README (`src/features/notifications/README.md`) states as an explicit decision that
`App.tsx` owns notification state because many features publish into it. So I would **not** extract a
standalone `useToasts()` store. I *do* agree with extracting the purely mechanical, self-contained
blocks the audit lists — the git-refresh debounce scheduler and the loading-phase state machine —
into hooks, and with the §3 French-comment fix (covered in **G**). Net: shrink App by moving
mechanical schedulers out, without relocating the documented toast ownership.

## O. Keep the `inflightGet` cache unless a cost case appears (§5) — Partially disagree

The in-flight GET dedupe is small, tested, and masks effect double-runs. The audit says remove it
"unless a real duplicate-cost case exists." Session-list polling is plausibly that case. I would keep
it and, per **I1**, only improve diagnosability — not delete it and its `api-dedupe.test.ts` on
suspicion.

## P. Bundle legacy-migration removal into a storage-version bump (§14, §17) — Defer

`pi-livecraft.theme`, `detailed-view`, git-sidebar keys, `?project=`, `migrateLegacyShortcut` each
have a paired test, so removal touches migration + test together. The audit itself says do this "in
one deliberate storage-version bump." Agree — this is a planned housekeeping commit, not part of the
above, and should be scheduled explicitly.

---

# Suggested sequencing

1. **A + B** (error policy + shortcut bug) — highest impact, mostly small, independently valuable.
2. **C + D** (hooks + backend helpers) — mechanical de-duplication, low risk.
3. **E + F + G + H + I** (exact-duplicate removal, price-heuristic deletion, language cleanup,
   test pruning, diagnosability) — a cluster of small commits.
4. **J** (structured field) — after the protocol check resolves the blocker.
5. **K/L/M/P** — only with the owner's decision and, for K, latency data.

Each numbered group is a separate commit with its own validation. No group depends on a deferred
item.
