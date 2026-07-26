# Composer

Follow the [step-by-step guide](../../docs/HOW-TO-COMPOSER.md) to add a button,
dropdown, or stat. Return here for the data flow and internal state reference below.

## Data flow

`App.tsx` → props → `Composer.tsx` → `onSend()` / `onCommand()` / `onAbort()`
→ `src/api.ts` → `sendPiCommand()` → Pi

All data arrives through props. The Composer never calls the backend directly.

## Sub-modules

| Module | Purpose |
|---|---|
| `Composer.tsx` | Form, textarea, images, slash-commands, send/stop, assembly |
| `composer.css` | All composer styles |
| `composer-images.ts` | Image paste, resize, compress (`maxComposerImages` = 4) |
| `composer-utils.ts` | `capitalizeLabel`, `formatTokens`, `readComposerDraft`, `isObject` |
| `prompt-title.ts` | Immediate session title, replaced later by Pi's extension title |
| `selects/ComposerSelect.tsx` | Generic Radix Select wrapper with tone-based icons |
| `selects/AgentSelect.tsx` | Agent picker — derives label from options, calls `onAgentChange` |
| `selects/ModelSelect.tsx` | Model picker — builds RPC `set_model` command from selection |
| `selects/ThinkingSelect.tsx` | Thinking level — maps level to `set_thinking_level` RPC |
| `selects/BehaviorSelect.tsx` | Steer / Follow-up toggle, only rendered while Pi is running |
| `status-bar/ComposerStatusBar.tsx` | Layout container for session info and stats |
| `status-bar/SessionInfo.tsx` | Session name, cwd, active status dot |
| `status-bar/SessionStats.tsx` | Cost and context usage with progress bar |

## Internal state

- `message`, `images` — the draft; persisted to `localStorage` per session
  (`pi-livecraft.composer-draft.<sessionId>`).
- `slashOpen`, `slashFilter`, `slashIndex` — slash-command popover.
- `openSelect` — which dropdown (agent/model/thinking) is open.
- `behavior` — `steer` vs `followUp`, only visible while Pi is running.
- `submitting` — prevents double-send during the API call.
- `preparingImages` — blocks send while clipboard images are being converted.

## Selects

The agent, model, and thinking dropdowns each live in `selects/` as standalone
components. `ComposerSelect` is the generic Radix Select wrapper they all use.
Each select encapsulates its own option derivation and `onValueChange` logic.
`onCommand()` sends the corresponding RPC command (`set_model`,
`set_thinking_level`) to Pi.

## Draft persistence

Each session has one draft in `localStorage`. The `readComposerDraft` helper
falls back to the legacy `pi-workbench.` prefix for migration. Drafts are
cleared on successful send, restored on failure.
