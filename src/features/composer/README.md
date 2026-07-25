# Composer

## Data flow

`App.tsx` → props → `Composer.tsx` → `onSend()` / `onCommand()` / `onAbort()`
→ `src/api.ts` → `sendPiCommand()` → Pi

All data arrives through props. The Composer never calls the backend directly.

## Sub-modules

- `composer-images.ts` — validation (`maxComposerImages` = 4), dimension limit
  (1600 px), size cap (350 KiB), `File` → base64 conversion.
- `prompt-title.ts` — immediate session title from first message, replaced later
  by Pi's extension-generated title.

## Internal state

- `message`, `images` — the draft; persisted to `localStorage` per session
  (`pi-livecraft.composer-draft.<sessionId>`).
- `slashOpen`, `slashFilter`, `slashIndex` — slash-command popover.
- `openSelect` — which dropdown (agent/model/thinking) is open.
- `behavior` — `steer` vs `followUp`, only visible while Pi is running.
- `submitting` — prevents double-send during the API call.
- `preparingImages` — blocks send while clipboard images are being converted.

## Selects

The agent, model, and thinking dropdowns use `ComposerSelect`, a local wrapper
around Radix Select. `onCommand()` sends the corresponding RPC command
(`set_model`, `set_thinking_level`) to Pi.

## Draft persistence

Each session has one draft in `localStorage`. The `readComposerDraft` helper
falls back to the legacy `pi-workbench.` prefix for migration. Drafts are
cleared on successful send, restored on failure.
