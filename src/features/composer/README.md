# Composer

Follow the [step-by-step guide](/docs/HOW-TO-COMPOSER.md) to add a button,
dropdown, or stat. Isolated draft rewrites use the same [isolated prompt](/docs/HOW-TO-RUN-ISOLATED-PROMPT.md)
mechanism; see its guide before changing that flow. Return here for the data flow and internal
state reference below.

## Data flow

`App.tsx` → props → `Composer.tsx` → `onSend()` / `onCommand()` / `onAbort()` /
`onImprovePrompt()` / `onSavePrompt()` → `src/api.ts` → backend or Pi

All data arrives through props. The Composer never calls the backend directly. Shub-agent
child sessions pass `readOnly`; the Composer then replaces its controls with a read-only notice
and rejects programmatic submission.

## Sub-modules

| Module | Purpose |
|---|---|
| `Composer.tsx` | Form, textarea, images, slash-commands, send/stop, assembly |
| `composer.css` | All composer styles |
| `composer-images.ts` | Image paste, resize, compress (`maxComposerImages` = 4) |
| `composer-utils.ts` | Label/token formatting, command detection, local `compact`/`name` command fallbacks, draft loading, `isObject` |
| `selects/ComposerSelect.tsx` | Lightweight non-modal select menu with tone-based icons |
| `selects/AgentSelect.tsx` | Agent picker — derives label from options, calls `onAgentChange` |
| `selects/ModelSelect.tsx` | Model picker — searchable popover with collapsible provider groups, issues RPC `set_model` from selection |
| `selects/ThinkingSelect.tsx` | Thinking level — lightweight non-modal picker that renders the levels Pi reports for the current model and maps the choice to `set_thinking_level` RPC |
| `selects/VerbositySelect.tsx` | Response verbosity — per-session override sent through the `/livecraft-response-controls` extension command, shown only for supported models |
| `selects/SummarySelect.tsx` | Reasoning summary — per-session override sent through the `/livecraft-response-controls` extension command, shown only for supported models |
| `selects/PromptSelect.tsx` | Prompt templates — previews, inserts, and saves Pi-discovered templates |
| `selects/BehaviorSelect.tsx` | Steer / Follow-up toggle, only rendered while Pi is running |
| `status-bar/ChatTopBar.tsx` | Two-line session strip pinned to the top of the chat window: session identity first, then usage stats. Workspace context lives in the sidebar; context usage in `ContextUsage` |
| `status-bar/SessionInfo.tsx` | Session name and active status dot |
| `status-bar/SessionStats.tsx` | `SessionStats` renders input/cache/output tokens, message and tool counts, and cost; `ContextUsage` renders context-window pressure as a compact two-line block in the composer's action row |

## Internal state

- `message`, `images` — the draft; persisted to `localStorage` per session
  (`pi-livecraft.composer-draft.<sessionId>`). Pending sessions pass `persistDrafts={false}` so an abandoned, not-yet-created session leaves no stored draft.
- `slashOpen`, `slashFilter`, `slashIndex` — slash-command popover.
- `openSelect` — which dropdown (agent/model/thinking) is open.
- `behavior` — `steer` vs `followUp`, only visible while Pi is running.
- `submitting` — prevents double-send during the API call.
- `preparingImages` — blocks send while clipboard images are being converted.
- `improving`, `improvePreset`, `suggestion` — isolated rewrite request and explicit comparison.
- `previewingPrompt`, `savedPrompts`, `promptSave`, `savingPrompt` — prompt preview and save flow.

## Selects

The agent, model, thinking, and prompt dropdowns each live in `selects/` as standalone
custom components. `ComposerSelect` is the lightweight non-modal menu used by the agent,
behavior, response-control, prompt, improve, and thinking controls. The model picker remains a
separate searchable menu because of its larger grouped catalog. None of these menus isolate the
full conversation DOM. Each select encapsulates its own option derivation and `onValueChange`
logic. `onCommand()` sends the corresponding RPC command (`set_model`,
`set_thinking_level`) to Pi. `PromptSelect` previews and inserts templates, and saves the
current draft through `onSavePrompt()`.

`ModelSelect` owns a custom portal popover for its large list: a filter input narrows every
group (matched groups render expanded), provider group headers expand and collapse with only
Favorites (pinned models) expanded by default, and the filter resets when the menu closes.
Keyboard navigation moves through visible rows only; the highlight follows model keys so it
survives re-filtering and pin-driven regrouping.

`ThinkingSelect` lists `snapshot.thinkingLevels`, which the backend fills from Pi's
`get_available_thinking_levels` for the current model. `VerbositySelect` and `SummarySelect`
render only while `snapshot.responseControls.supported` is true; the backend derives that report
from the current model, the extension's registered command, and the newest response-controls
session entry, so no model list is duplicated in the frontend.

## Draft persistence

Each session has one draft in `localStorage`. Drafts are cleared on successful
send and restored on failure.
