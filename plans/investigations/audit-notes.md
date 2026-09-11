# Code Health Audit — Overcomplication, Test Value, Exception Handling

Audit of the current codebase (38k lines TS/TSX, 399 tests). No code was changed. Read §Executive summary first; §19 records coverage and method.

## Executive summary

The codebase is in better shape than the audit brief assumed: layering follows the documented architecture, most features own their logic cleanly, and several modules (terminal flow control, quota error reporting, git parsing, session-store scanning) are genuinely well-engineered. The recurring problems are:

1. **Error-surfacing inconsistency** (§1) — three regimes coexist; background refreshes and several browser-pane actions swallow errors, and the backend logs nothing on unexpected failures. No global frontend handler exists.
2. **"Prompt as RPC" protocol hacks** (§13) — agent options, quotas, and environment refresh all send literal prompt strings (`/agent`, `/livecraft-quotas`) into Pi sessions and intercept/verify the side effects, each with its own bespoke interception and timing logic. Plus stringly-typed title matching (`'Select an agent'`, `'Pi Livecraft questionnaire'`) and ANSI-text parsing of data our own extension produced.
3. **Manager session-reuse protocol** (§7) — the most intricate machinery in the repo, bought for new-session startup latency; the clearest candidate for deletion if the heuristic no longer pays.
4. **Copy-paste UI infrastructure** (§10) — 4 duplicated menu-dismiss effects, 3 duplicated drag-resizers, 2 dropdown implementations, 5 copies of text-part flattening, 3 near-identical width-clamp modules.
5. **Multi-model authorship artifacts** (§17) — French test titles (~37% of the suite), French UI strings (`car.`, the entire session-analysis LLM prompt), `ponytail:` comment markers, a self-conflicting default shortcut (`alt+2`), and drifted helper names.
6. **Test suite** (§16) — broadly healthy and behavior-focused; the low-value pockets are branch-exhaustive CRUD tests (themes), "removed preset stays removed" tests, exact-default-shortcut pins, and partial-JSON-parser tests that only exist to serve a cosmetic streaming feature.

Top simplification opportunities by leverage:

| Change | Section | Est. reduction | Risk |
|---|---|---|---|
| Drop manager session reuse (always spawn) | §7 | ~150 lines + tests | new-session startup latency |
| Shared error policy: log server-side, toast or warn frontend | §1, §4, §6 | small; large diagnosability gain | low |
| Structured fields instead of title/ANSI parsing between our extension and app | §13 | ~60 lines + removes silent-break risk | needs a Pi extension-data channel check |
| `useDismissableMenu` + `usePanelResize` hooks | §10 | ~200 lines | low |
| Delete cross-provider struck-through price matching + provider name table | §9 | ~80 lines | cosmetic |
| Decide the partial-tool-args streaming feature's fate | §8 | up to ~200 lines incl. tests | UX regression if removed |
| Backend route helpers (`requireString`, error-class map) | §6 | ~100–150 lines | low |

Categories used per finding:

- **Overengineering** — code, logic, or architecture more complex than the requirement it serves.
- **Test value** — tests that verify implementation details instead of behavior, or that only covered a transient implementation state.
- **Exception handling** — swallowed, silently dropped, or user-invisible errors.

## How to read this document

Findings are grouped by feature (frontend feature folder, server capability, or Pi extension), preceded by cross-cutting sections for patterns that apply everywhere. Severity labels:

- **High** — real user impact or ongoing maintenance burden; simplify/fix first.
- **Medium** — works today but complexity or silence will bite; simplify opportunistically.
- **Low** — polish; note for later.

---

## 1. Cross-cutting pattern: error surfacing is inconsistent (exception handling)

**Severity: High.** The project's intent is that exceptions are logged *and* shown to the user. Three different regimes coexist:

1. **Interactive paths** — `await` + `showToast('error', messageOf(cause))`. Good: server error messages reach the user (`src/api.ts` `performRequest` converts non-2xx JSON `{error}` into `Error` with the server's message). This is the pattern everything should follow.
2. **Fire-and-forget paths** — `void fn().catch(() => {})` / `.catch(() => undefined)`. The failure disappears: no toast, no console output. Examples:
   - `src/App.tsx:836` initial quota load, `src/App.tsx:842` initial environment load, and the same two inside `handleManagerPiEvent` (lines ~895, ~902). If the backend errors, the user just sees an empty widget forever.
   - `src/api.ts` `sendBrowserInput` (`.catch(() => {})`), `resizeTerminal` — documented as "status errors surface via the stream", which is defensible for these two, but the pattern is copied to places where no stream exists.
   - `src/features/browser/BrowserView.tsx` — five separate `.catch(() => {})` on navigate/viewport/start (lines 133, 147, 200, 252, 255). A failed URL navigation is silently ignored; the address bar just doesn't change.
   - `src/features/workspace/useProjects.ts:21` — `listRecentSessions(path).catch(() => [])` renders an empty session list with no indication that loading failed.
3. **Server-side unexpected errors** — `server/backend.ts` top-level `route().catch` returns `{error}` to the client but **never logs it** (the whole backend has exactly one `console.error`, for provider failures). Same in `server/manager.ts` `handleRequest`: every failure is formatted into the response and dropped. `socket.on('error', () => clients.delete(socket))` in both `manager.ts` and `manager-client.ts` (`socket.on('error', () => undefined)`).

Consequence: diagnosing a reported UI glitch requires reproducing it; nothing in the server logs records unexpected exceptions. A single shared approach — log every non-HttpError server-side, toast every rejected interactive promise in the frontend — would remove most of this class.

Also missing: **no React error boundary and no `window.onerror`/`unhandledrejection` handler** anywhere in `src/`. A render error or an unhandled promise rejection in any component currently shows a blank page with zero information.

**Recommendation:** (a) add a global `unhandledrejection`/error handler + error boundary that routes into the toast system; (b) replace the `catch(() => {})` on background refreshes with a debug toast or at least `console.warn`; (c) log non-HTTP errors in the backend/manager before responding 500.

---

## 2. Cross-cutting pattern: hand-written validators duplicate shared types

**Severity: Low–Medium.** SSE and manager payloads are validated by ad-hoc functions at each consumer:

- `src/api.ts` `parseManagerEvent` (whitelist + shape check).
- `src/App.tsx` `isManagerRuntimeStatus` re-derives the `ManagerRuntimeStatus` union by hand.
- `src/api.ts` `subscribeBrowserEvents`/`subscribeTerminalOutput` re-do `isObject(...) && typeof x === 'string'` per event.
- `server/manager-runtime-monitor.ts` `managerRuntimeIdentity`, `server/backend.ts` `isModelBody`, `server/manager.ts` `isModelOption` (the last two are the same function twice).
- `piHasActiveWork` in `server/manager.ts` validates five fields of Pi's `get_state` reply on every call.

None of this is wrong for a trust boundary, but the same fields are validated in multiple files with slightly different strictness. A small shared validation module in `shared/` (or one `assert`-style helper per message type) would remove the duplication and the drift risk. Note `isModelBody` vs `isModelOption` are literally the same predicate in two layers.

---

## 3. App.tsx — size and composition (overengineering)

**Severity: Medium.** `src/App.tsx` is ~1,990 lines with a single ~1,800-line `LivecraftProjectApp` component holding ~40 state/ref declarations. The architecture doc sanctions App as the cross-cutting orchestrator, but several blocks inside it are *feature-local* logic that grew in place:

- **Toast lifecycle** (dismiss animation state, 160 ms timers, manager-unavailable debouncing via a `Map<string, number>` of pending timers keyed by toast id, string comparison `message === managerUnavailableMessage`). This is a self-contained notifications feature living inline; it would be simpler as a `useToasts()` hook with an explicit `pauseManagerErrors()` API instead of the magic-message comparison.
- **Loading-phase state machine** (`'hidden' | 'entering' | 'visible' | 'exiting'` + two 200 ms timers) for a fade overlay.
- **Git refresh debounce + version counter** (`gitRefreshVersionRef`, `gitRefreshTimerRef`, `scheduleGitRefresh`) — a self-contained debounced scheduler inline in App.
- **The `/agent` selector interception** (`fetchAgentOptions` sends the literal prompt `/agent` to the session, watches for a `select` dialog, cancels it, caches options, dedupes with `agentResponsesSentRef`, plus a stale-response sweep in `handleSessionsRefreshed`). This is a protocol workaround built on top of a prompt hack; see §13 and §15 for the root cause.

None of these is individually wrong, but together they make the orchestrator the hardest file in the repo. Extracting each block into its owning feature (notifications hook, git hook, composer agent support) would shrink App roughly by half without changing any contract.

Minor: `readShortcuts` carries a French doc comment ("Lit une éventuelle ancienne liste invalide…") — sign of multi-model authorship; repo rule is English.

---

## 4. App.tsx — silent background failures (exception handling)

**Severity: Medium.** Besides the cross-cutting items in §1:

- `refreshGit(cwd, notifyOnError)` — the parameter name says "notify", but the implementation *rethrows* when true and swallows otherwise; the caller shows the toast. Misleading name; consider `shouldThrow`/`interactive`.
- `refreshVSCodeTitleBarColor` swallows all errors to `null` (cosmetic, acceptable, but undocumented).
- `handleComposerSend` correctly undoes optimistic state and rethrows — good pattern worth imitating.

---

## 5. src/api.ts

**Overengineering (Low–Medium):**

- `createOrderedSender`/`OrderedSender` is exported as a general abstraction but has exactly one consumer (terminal input), while browser input uses a *different* mechanism (unordered fire-and-forget POST per event). Two parallel input-transport designs for two panes with identical needs; and the general-looking export invites reuse that never happened. Either adopt the ordered sender for browser input or inline it into the terminal feature.
- `request()` deduplicates concurrent identical GETs via `inflightGet`. Small and tested, but no caller depends on strict call-count semantics — the cache exists to mask effect double-runs. Keep only if a real duplicate-cost case exists (e.g. session list polling); otherwise it's one more concept.

**Exception handling (Low):**

- `parseManagerEvent` returns `null` for malformed events silently; the browser stream handlers drop malformed payloads with only a comment. A `console.warn` here would make stream corruption diagnosable.

---

## 6. server/backend.ts

**Overengineering (Medium):** The documented contract keeps routes here, but the file is 954 lines of repeated boilerplate:

- `if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')` (and close variants) appears ~12 times.
- The `try { … } catch (error) { if (error instanceof XError) throw new HttpError(status, message); throw error }` mapping is repeated for `WorkspaceFileError` (×3), `VSCodeSettingsError`, `TerminalTemplateError`, and browser start/navigate/input — five inline mappers that a single route-level table (error class → status) would replace.
- `resolveBrowserWorkspace` is also called by the *terminal* routes (name drift from copy-paste).

A 50-line helper (`requireString(body, 'cwd')`, an error-class→status map installed around `route`) would remove roughly 100–150 lines without moving any route out of the backend.

**Exception handling (Medium):**

- Unhandled route exceptions → 500 to client, nothing logged (see §1).
- `navigate`/`dispatchInput` catch-all replaces the real cause with `'The browser session is not live'` (409) — if CDP fails for another reason the user is misdiagnosed and the cause is lost. Log or include `errorMessage(error)` when it isn't a liveness failure.

---

## 7. Manager stack (manager.ts, pi-process.ts, supervisor, runtime monitor)

The guarded-restart design is documented and intentional (MANAGER-LIFECYCLE.md); the audit does not challenge the contract. Findings inside it:

**Overengineering (Medium):**

- **Session reuse / reassignment** (`minimumOpenSessionsPerWorkspace`, `idleReuseAfterMs`, `switching`, `bufferedEvents`, `openingSessions` dedupe map, `session_reassigned` event with id rewrite). This is the single most intricate protocol in the repo, bought to make *new* sessions start faster in a workspace that already has ≥3 idle sessions. The benefit is a one-time startup latency; the cost is the event-rewriting logic that the frontend must also special-case. Consider whether the 3-open-sessions heuristic still pays for itself; plain "start a new process per session" would delete `reuseSession`, `bufferedEvents`, `switching`, and the reassignment path (~150 lines + integration tests).
- `activeAgentFromStatus` parses the agent name out of the extension's *terminal-formatted* status text (`'Agent:'` prefix + `\u001b` escape) — the producer of that text is our own `pi-extensions` extension, which could send a structured `activeAgent` field instead. Parsing what you control is accidental complexity; see §13 and §15.
- The action list for manager requests is duplicated between `isManagerRequest` (validation) and `tracksActivity` in `handleRequest` — adding an action requires editing both.
- `ManagerRuntimeMonitor.#refreshExpectedRevision` calls `calculateManagerRuntimeRevision()` **twice**, re-hashing all runtime files; the first call's `revision` is discarded. Likely an editing leftover.

**Exception handling (Low):**

- `reuseSession`'s `catch { …; return false }` drops the switch failure entirely — no log, user just gets a slower new session. At minimum `console.error` the cause.
- `ManagerClient` `socket.on('error', () => undefined)` — the subsequent `close` handling covers recovery, but the error itself is invisible.

**Platform question:** `pi-process.ts` carries a Windows taskkill process-tree path, `windowsHide`, and `child.stdin.end()` shutdown semantics. If Windows is not an actually supported target, this is ~40 lines of speculative code; if it is, a note in docs would prevent regressions.

---

## 8. Conversation feature (src/features/conversation/)

The largest frontend feature (~5,500 lines). Core streaming state (`useConversationRuntime`), reconciliation, and rendering are separate; overall layering is sound. Findings:

**Overengineering (Medium–High, UX polish vs. machinery):**

- **Hand-written incremental JSON parser** (`tool-presentation.ts`: `partialJsonObject`, `readJsonString`, `decodeJsonString`, `partialJsonPrimitive`, `skipWhitespace` — ~150 lines plus `provisionalToolName` and `streamedToolArguments` merging). Its only purpose is showing *partial tool arguments* (the growing `command`/`path`) in the tool-call header while the model streams, and guessing the tool name before the header arrives. This is the single most algorithmically risky piece of the frontend (partial string escapes, unicode, truncation edge cases) serving a transient cosmetic state that is replaced seconds later by the real call. Options: (a) accept and keep (documented here as intentional), (b) show a generic "generating tool call…" placeholder until `toolcall_end`, deleting the parser. Worth an explicit product decision; today the cost is silent and permanent.
- **ToolCallCard expansion state** (`expanded`, `semiExpanded`, `partialOutputExpanded`, `argsExpanded`, `codeRendered`, deferred code rendering, IntersectionObserver + measured-placeholder retention in `ToolCallPreview`). Five interacting expansion states + a two-phase render dance per card. The perf goals (avoid highlighting huge files, keep scroll position) are real, but the state machine has visible seams: in semi-detailed view `activate()` sets `expanded=true` together with `semiExpanded` so the first click permanently expands the card even after returning to detailed view. Consolidating to one `viewMode` state per card would remove the seams.
- **Conversation auto-scroll machinery** (`Conversation.tsx`: `autoScrollRef`, `upwardScrollIntentRef`, `navigationInProgressRef`, wheel/keyboard/pointer-drag intent tracking, `scrollend` listener *plus* a 3-stable-frame rAF polling fallback, ResizeObserver pinning). Each piece was added to fix a real bug (comments admit this), but the intent-tracking heuristics are the classic sign of accumulated patches. `conversation-scroll.ts` already extracts the pure decisions — good — yet the component still orchestrates four refs and five input handlers. A small `useAutoScroll` hook with an explicit `follow | detached` state would carry the same behavior with less surface.

**Duplication (Low):**

- `isImageContent` is defined twice (message-display.ts, MessageCard.tsx) with the same MIME regex.
- Text-part flattening exists three times: `visibleText` (MessageCard), `toolContentText` (tool-protocol), `extractUserText` (message-reconciliation) — each subtly different (join with '' vs '\n', trim rules).
- `readContentDisplay` for read/write is computed in ToolCallCard, then recomputed inside ToolCallPreview and again in ToolCallContent; the language-alias map also duplicates `languageByExtension` in tool-presentation.ts (two tables mapping the same extensions).

**Exception handling / text (Low):**

- `parseToolArguments` silently returns `undefined` on invalid partial JSON — correct for its purpose, no change needed.
- UI text leak: tool-call header shows `↘ N car. · ↗ M car.` — "car." is French for *caractères* in an otherwise English UI (ToolCallCard, aria-label uses the English word). Multi-model authorship artifact.
- `observedRequestDurations` in `useConversationRuntime` keys measured durations by the **timestamp of the last user message found by scanning the refreshed snapshot** (`lastUserTimestamp`). A fragile join across layers to feed the session-analysis widget; storing the prompt text or a correlation id would be sturdier.

---

## 9. Composer feature (src/features/composer/)

Error handling here is the best in the repo — every async path reports through `onError`, send failure restores the draft. Findings:

**Overengineering (Medium):**

- **Two dropdown implementations.** `ModelSelect` (392 lines) builds a custom portal popover with manual flip/positioning, window scroll/resize listeners, keyboard navigation, highlight repair, and expandable groups — while every other toolbar select uses the shared Radix-based `ComposerSelect`. The grouping/favorites/search justify a custom list, but the positioning and keyboard work duplicate Radix Select primitives; a Radix `DropdownMenu`/`Command`-style composition (or reusing the popper) would delete the manual placement code.
- **Provider name table + price heuristics** (`model-select-utils.ts`): a 33-entry hardcoded `PROVIDER_NAMES` map (with an adequate title-casing fallback right below it), a hardcoded `subscriptionProviders` set, and `baseModelKey` — a regex that rewrites `glm-5p2`-style ids into `glm-5.2` so a *struck-through reference price* from a sibling provider can be shown for subscription models. That last one is speculative display cleverness with a fragile cross-provider join (any id containing digit-`p`-digit is mutated). Recommend: drop the cross-provider price matching; keep costs only when Pi reports them; let the title-case fallback carry display names.
- **Imperative request channels from App**: `submitRequest` (counter), `focusRequest` (counter), `requestedSelect`, `draftRequest`, `onSelectOpened` — five side-channels to coordinate App-level commands with the composer. Each is small, but the pattern (App increments a counter to trigger an effect) is the kind of indirection that grows; a single `composerRequest: {kind, …}` union or refs would be easier to follow.

**Duplication (Low):** `formatTokens` exists in both `composer-utils.ts` and `conversation/message-usage.ts` with slightly different behavior (m-scaling vs k-only). `capitalizeLabel` is used by AgentSelect and ThinkingSelect — not dead, but its home in `composer-utils.ts` (which also re-exports `isObject` for a single consumer) shows mild utility-drawer accretion.

---

## 10. Workspace feature (src/features/workspace/)

**State model (Medium–High):** `useWorkspaceSessions` (669 lines) maintains **five overlapping session collections**: `sessions` (live from manager), `recentSessions` (disk scan), `sentSessions` (locally-created, message-sent), `pinnedSessions` (localStorage), `archivedSessionPaths` (localStorage). `renameSession` must update four of them; `sidebarSessions` merges three on every render and is re-computed in App's `executeCommand` and `paletteCommands` too. Each list was added for a real feature (pins, archive, optimistic "my sessions"), but the joins between them (by `id` *or* `sessionPath`, sometimes both) are the bug-prone center of this feature. A normalized model (one map keyed by `sessionPath` with derived views) would remove the four-way rename/update choreography.

- **Transient-new-session lifecycle**: creating a session immediately spawns a Pi process; if the user navigates away without messaging it, `discardTransientNewSession` closes it (plus unmount cleanup, `retainNewSession` on first successful send from App, `creatingSessionRef`/`selectCreatedSession`). An entire protocol to keep empty sessions out of the sidebar. Simpler alternative: don't surface a session in the sidebar until its first message (derive "sent" from `session.name !== 'New session'` or a manager-side flag), deleting the transient lifecycle. Tradeoff: the current design guarantees the process is warm before the first keystroke.
- **`refreshSessions` is the feature's load-bearing tangle**: version counter, auto-select with inline `requestOpenSession` (a refresh that *opens sessions* as a side effect), URL-forced path consumed once, name merging from recents, completed-set pruning, sent-list reconciliation. It works, but auto-select would be clearer as its own named step rather than a branch inside refresh.
- **WorkspaceSidebar (979 lines) contains four copies of the same menu-dismiss effect** (pointerdown-outside + Escape + focus-restore) for session context menu, workspace menu, brand menu, and session-list menu (lines ~230–320), plus a fifth, different dropdown dismissal in Composer's slash commands. A `useDismissableMenu(ref, open, onClose)` hook would remove ~150 lines of copy-paste that must be kept in sync.
- **Three hand-rolled pointer-drag resizers** (WorkspaceSidebar, RightSidebar, FileContentPane) with near-identical `startResize`/`resize`/`stop` logic and separate clamp helpers per feature. Same hook opportunity (`usePanelResize`).
- Small helper modules (`sidebar-sessions.ts`, `session-indicator.ts`, `session-time.ts`, `pinned-sessions.ts`, `archived-sessions.ts`, `project-*.ts`) are clean and well-tested — no findings.

**Exception handling (Low):** `refreshPinnedSessions` swallows failures silently (comment: pins keep last known metadata) and the unmount cleanup uses `.catch(() => undefined)` — both acceptable but below the project's stated bar.

---

## 11. Quotas vertical (pi-extensions/quotas.ts + server/features/quotas + shared/quota-parsers + QuotaWidget)

**Architecture note — "prompt as RPC" (Medium, cross-cutting with §13):** quota refresh and reset are implemented by sending the *prompt* `/livecraft-quotas` / `/livecraft-quotas-reset` into a Pi session. The backend then waits (≤5 s grace, `waitForQuotaReport`) for the extension's `setStatus` report to arrive via SSE and compares before/after reset counts to decide success. Three features (quotas, agent options, prompt improvement) each reimplement this request/response-over-prompt dance with their own interception and verification. This is the main architectural smell of the repo; see §13.

**Reverse-engineered integrations (Medium, accepted fragility):**

- ChatGPT `wham/usage` + undocumented `rate-limit-reset-credits` endpoints (with irreversibility handled by fresh idempotency keys — good).
- GitHub Copilot internal user API with hardcoded spoofed VS Code/Copilot version headers (`'Editor-Version': 'vscode/1.107.0'`) — will silently rot.
- **ZCode credential-store decryption**: the extension replicates ZCode's AES-256-GCM scheme including the deterministic per-machine fallback key (`zcode-credential-fallback:${platform()}:${homedir()}:${username}`). Security-adjacent and doubly fragile (any storage-format change silently hides reset cards). Consider a health-check/log when the decryption path stops resolving, or shelling out to ZCode if it gains a status command.

The parser layer (`shared/quota-parsers.ts`) defensively handles multiple upstream response shapes — justified for undocumented APIs. Error handling is exemplary here: every failure becomes a typed `{ok:false,error}` report the widget renders.

`quota-display.ts` hardcodes GLM peak-hour windows in Singapore time — user-specific provider tuning; fine, but undocumented for other users.

---

## 12. Browser & terminal panes

**Browser (server/features/browser + src/features/browser):**

- The livecast stack (hand-rolled minimal CDP client with injectable transport, screencast frame ack pacing, viewer counting, iframe fallback) is intrinsically complex but serves documented browser behavior. The `#appearAsNormalChrome` UA/webdriver spoofing is best-effort with swallowed CDP errors — consistent with its comment, acceptable.
- `BrowserView.tsx` accumulates the repo's densest cluster of `.catch(() => {})` (navigate, viewport, start, clipboard). A failed address-bar navigation is completely silent — user sees nothing happen. This contradicts the project's error-surfacing bar and should ride the stream status or a toast.
- `browser-debug` surface (`BrowserDebugWidget` 353 lines + `/api/browser/debug`) is a diagnostics panel shipped in the production UI. Useful while the feature matures; candidate for a debug-only gate once stable.

**Terminal (server/features/terminal + src/features/terminal):** `TerminalChunkBuffer` (bounded replay) and `WatermarkGate` (hysteresis flow control) are textbook-correct and well-tested — this is the good kind of complexity. `launcher.ts` expands a user template with `{cwd}`; validation errors map to HTTP 400. No findings beyond the misnamed `resolveBrowserWorkspace` reuse noted in §6.

---

## 13. Cross-cutting pattern: stringly-typed coupling to Pi's extension UI

**Severity: Medium–High.** Several features identify Pi protocol objects by **human-facing title strings**:

- `isAgentSelector` (src/features/dialogs/dialog-protocol.ts): `value.title === 'Select an agent'` — if Pi renames this title, the App's agent-options interception silently breaks.
- `isAskUserQuestionDialog`: `value.title === 'Pi Livecraft questionnaire'` — our own extension's marker is the dialog title.
- `activeAgentFromStatus` (server/manager.ts): parses `Agent:` + ANSI escape from the `setStatus` text that our own `session-environment`/`response-controls`-adjacent extension produced.

The questionnaire's JSON-in-`editor`-prefill envelope is forced by Pi's extension UI primitives (select/confirm/input/editor only) — that part is a platform constraint and reasonably handled with a versioned protocol. But where *both* ends are ours (extension ↔ frontend/manager), a structured field (e.g. a `livecraft:` prefix in `customType`, or a dedicated status payload field) would remove the title-matching. The `/agent`-prompt hack for agent options (§3) is the same pattern one level up.

---

## 14. Settings & themes (src/features/settings)

`themes.ts` (509 lines) implements 6 built-in palettes, user themes with built-in overrides, legacy storage migration, full validation/normalization of persisted JSON, and derived variables. Verbose but boring and well-tested; the legacy `pi-livecraft.theme` migration and `simple-expanded`/`detailed-view` legacy keys in App are the only "old era" remnants — candidates for removal on the next storage-version bump (see §17).

---

## 15. Pi extensions (pi-extensions/)

- `ask-user-question.ts` — tool + TUI fallback + Livecraft editor-dialog protocol. Careful duplicate-registration guard with a documented rationale. Good.
- `response-controls.ts` — clean, small, state restored from session entries. Good.
- `session-environment.ts` — publishes tools/skills/system-prompt/context files via setStatus. Note: the *agent name* embedded in this channel's status text is what the manager parses (§13).
- `quotas.ts` — see §11.

All extensions communicate failures as visible reports or notify calls; no swallowing found.

---

## 16. Test suite audit (test/, 399 tests across 73 files)

**Overall verdict: healthier than expected.** Most tests assert observable behavior with real inputs (real `git` in temp dirs, real Chrome with a skip guard, real manager processes, fixture JSONL files mirroring Pi's format). Examples of high-value tests worth keeping exactly as they are: `git.test.ts` (real repos: reset/revert/push/discard), `manager.integration.test.ts` (real manager+Pi: restart reconciliation, concurrent opens), `browser-smoke.test.ts` (real Chrome, guarded), `terminal-session.test.ts` (buffer/watermark flow control), `pi-session-store.test.ts` (boundary-spanning head/tail scans), `message-reconciliation`/`tool-calls` (streaming contract), `session-snapshot` (replay contract).

**Low-value or obsolete candidates (Test value):**

- **`prompt-improvement.test.ts` — 9 tests for a 3-line mapping**, five of which assert that *removed* presets (`actionable`, `debug`, `plan`, `concise`, `review`) return `undefined`. These pin history, not behavior; one "unknown key → undefined" test covers the contract.
- **`themes.test.ts` — 39 tests**, ~28 with French titles, exhaustively covering every CRUD helper branch (duplicate-name dedupe, rename-ignore-empty, delete-fallback-to-light, …). The persistence-validation tests earn their place; the in-memory object-manipulation branches are low value and would survive as ~8 tests.
- **`shortcuts.test.ts` — “les nouveaux raccourcis par défaut sont définis”** pins exact default keybinding strings (`alt+&`, `alt+2`, …). Default *values* are configuration, not logic; this test fails on every intentional rebalance while having caught nothing. Ironically the suite *tests* `shortcutConflicts()` but never applies it to `defaultShortcuts` — which contain a real conflict (`open-thinking` and `focus-composer` both default to `alt+2`, see §17). A better test: "defaults contain no conflicts".
- **`tool-presentation.test.ts` — the partial-JSON tests** (“shows streamed scalar arguments…”, “decodes escaped streamed paths…”) exist only for the cosmetic streaming-args feature (§8). If that feature is cut, these ~5 tests go with it. The remaining diff/preview/presentation tests are fine.
- **`api-dedupe.test.ts`** — well-written, but only valuable if the in-flight GET cache (§5) is; its fate should follow the decision on the cache itself.
- **`composer-commands.test.ts`** — 9 tests over tiny string predicates; individually fine and cheap, but they document local hacks (`/compact`, `/name` interception) rather than Pi behavior — a reminder that these commands are compensations, not features.
- **Meta-tests that are actually valuable (keep, do not confuse with the above):** `manager-runtime.test.ts` “declares every local runtime import reachable from manager.ts” guards the runtime manifest against drift — it protects a real operational contract. `pi-skills.test.ts` guards the shipped skill file. `git-sidebar.test.ts` mixes three unrelated test files' content (width clamp, session restore, diff parsing) — reorganize for discoverability.

**Housekeeping:** ~146/397 test titles are French (themes, shortcuts, session-analysis, ask-user-question, recent-workspaces, workspace-sidebar, parts of git-sidebar). Repo convention is English; beyond consistency, non-English titles complicate `--test-name-pattern` filtering. `evals/documentation-routing.ts` is an eval harness (spawns a Pi session, external model calls, costs money) — correctly quarantined under `evals/` and gated in AGENTS.md; just be aware `npm test` (node --test) does not run it, which is right.

---

## 17. Multi-model authorship artifacts

Concrete evidence of the piecemeal, multi-model history the audit brief describes:

- **Language drift:** French test titles (~37% of the suite, §16); French comment in `App.tsx` `readShortcuts`; French UI string `↘ N car.` in ToolCallCard; and — most impactful — the **entire session-analysis LLM prompt is French** (`buildSessionAnalysisPrompt` instructs the model to answer in French, 120 words, fixed structure) while every other surface is English. If the French analysis output is not an explicit product choice, it's an artifact.
- **`// ponytail:` comment markers** in `server/jsonl.ts` and `GitWidget.tsx` — model-specific note syntax that leaked into the code.
- **Real bug from incremental edits:** `defaultShortcuts` maps both `open-thinking` and `focus-composer` to `alt+2` (command-registry.ts lines 61/71). App's keydown handler picks the first match, so `focus-composer`'s default binding is dead. `shortcutConflicts()` exists and is shown in Settings but never applied to defaults; the shortcut test pins the conflicting values as correct.
- **Name drift:** `resolveBrowserWorkspace` used by terminal routes (§6); two identical `isModelBody`/`isModelOption` predicates in different layers; three parallel clamp/read modules; `isCompactCommandDraft`/`isNameCommandDraft` special cases accreted in composer-utils.
- **Legacy storage migrations kept past their usefulness:** `pi-livecraft.theme`, `pi-livecraft.detailed-view`, `pi-livecraft.git-sidebar-collapsed`, `pi-livecraft.git-sidebar-width`, legacy `?project=` URL form, `migrateLegacyShortcut`. Each migration has a test, so removal requires touching both — do it in one deliberate storage-version bump.

---

## 18. Files feature, session index, right sidebar, commands

No significant findings. `FileContentPane` surfaces file-load errors inline (good); `session-index.ts` is clean (adds two more copies of the text-flattening helper, see §8); `command-registry.ts` derives widget commands from `rightWidgetDefinitions` without duplication (good); width-clamp modules are correct but triplicated (§10).

---

## 19. Method and coverage notes

Every frontend feature folder, all server modules, all four Pi extensions, shared modules, and the full test suite were reviewed. Files were read in full for: App.tsx, api.ts, backend.ts, manager.ts, pi-process.ts, manager-supervisor.ts, manager-runtime-monitor.ts, manager-runtime.ts, manager-client.ts, useConversationRuntime.ts, activity.ts, tool-protocol.ts, tool-presentation.ts, message-reconciliation.ts, message-usage.ts, message-display.ts, ToolCallCard.tsx, ToolCallOutput.tsx, MessageCard.tsx, Conversation.tsx, Markdown.tsx, Composer.tsx, composer-utils.ts, model-select-utils.ts, model-favorites.ts, useWorkspaceSessions.ts, sidebar-sessions.ts, session-indicator.ts, WorkspaceSidebar (structure + menu/resize regions), session-analysis.ts + widget structure, quotas extension + service + cache + parsers + display, git server module + widget structure, browser session/service/cdp-client + BrowserView structure, terminal session/launcher + views, ask-user-question.ts, response-controls.ts, session-environment.ts + service, dialog-protocol.ts, command-registry.ts, right-sidebar.ts, themes.ts (structure), pi-session-store.ts, session-snapshot.ts, jsonl.ts, sse-response.ts, system-integration.ts, vscode/launcher.ts, run-isolated-prompt.ts, FileContentPane.tsx, and all test files via title survey plus targeted full reads. Remaining areas received structural skims only: ProjectHome/ProjectPicker/DirectoryPicker, BrowserDebugWidget details, SessionIndexWidget details, prompt-templates.ts, pi-launcher.ts, home-path.ts, environment-cache.ts merge rules, and the CSS files (out of scope for this audit).

