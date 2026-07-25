# Modify the composer

This guide covers adding a toolbar button, dropdown, or session stat to the composer.
Every step is required unless noted otherwise. Open
[`Composer.tsx`](../src/features/composer/Composer.tsx) alongside and follow its shape.

## 1. Understand the data flow

The composer never calls the backend directly. All data arrives through props from
`App.tsx`; all actions go back through callbacks.

```
App.tsx  ──props──→  Composer.tsx  ──onSend / onCommand / onAbort──→  App.tsx
                                                                        │
                                                                   src/api.ts
                                                                        │
                                                                      Pi
```

**Key props:**

| Prop | Purpose |
|---|---|
| `snapshot` | Current Pi state (`state`, `models`, `stats`, `commands`) |
| `commands` | Available slash commands from `snapshot.commands` |
| `onCommand(command)` | Send any RPC command (`set_model`, `set_thinking_level`, …) |
| `onSend(message, images, behavior)` | Send a prompt with optional images |
| `onAbort()` | Stop generation |
| `onError(cause)` | Report an error to the notification stack |

If the composer needs data or a callback that isn't already a prop, add it to the
interface and pass it from `App.tsx`. Never call `fetch` or `src/api.ts` directly
inside the composer.

## 2. Add a toolbar button

The toolbar lives inside `<div className="composer-tools">`. Each button is a plain
`<button>` or a `<Tooltip>` wrapper.

**Pattern:** button → callback prop → `App.tsx` handles the action.

```tsx
// Inside <div className="composer-tools">

<Tooltip label="My action">
  <button
    aria-label="My action"
    className="icon-button"
    disabled={running}
    onClick={() => onMyAction()}
    type="button"
  >
    {/* SVG icon here */}
  </button>
</Tooltip>
```

- Use `Tooltip` from `../../components/Tooltip.tsx` for hover labels.
- Buttons that shouldn't fire while Pi is running check `running`.
- Buttons that need an active session guard with `!session.id`.
- Use the `.icon-button` class for consistent sizing. Add `.danger` for destructive
  actions.

**Props and App.tsx wiring (optional):**

If the button needs a callback that doesn't exist yet:

```tsx
// In Composer's prop interface
onMyAction: () => void
```

```tsx
// In App.tsx, where <Composer> is rendered
<Composer
  // …existing props…
  onMyAction={() => { /* your logic */ }}
/>
```

## 3. Add a dropdown

The composer uses `ComposerSelect`, a local wrapper around Radix Select defined in the
same file. It provides consistent styling, keyboard navigation, and portal-based
rendering.

**Pattern:** `ComposerSelect` → `onValueChange` → `onCommand()` for Pi actions, or a
local callback for UI-only state.

```tsx
<ComposerSelect
  ariaLabel="My option"
  onValueChange={(value) => {
    void onCommand({ type: 'my_rpc_command', field: value }).catch(onError)
  }}
  options={[
    { label: 'First', value: 'first' },
    { label: 'Second', value: 'second' },
  ]}
  placeholder="Choose…"
  tone="agent"
  value={currentValue}
/>
```

**Props:**

| Prop | Notes |
|---|---|
| `ariaLabel` | Required for accessibility |
| `options` | `{ label: string, value: string }[]` |
| `value` | Currently selected value (controlled) |
| `onValueChange` | Called with the new value |
| `tone` | `'agent'`, `'model'`, `'thinking'`, `'behavior'`, or `'command'` — sets the icon and color |
| `disabled` | (optional) Greys out the select |
| `open` / `onOpenChange` | (optional) For external open control (palette-triggered selects) |
| `triggerRef` | (optional) For focusing the trigger from outside |

Wrap `onCommand()` calls in `void … .catch(onError)` — the composer doesn't own error
display.

## 4. Add a session stat

Stats appear in `<div className="composer-stats">` inside the footer. Each stat is a
`<span>` with a `<b>` label and inline content.

```tsx
<span>
  <b>My stat</b>
  {myFormattedValue}
</span>
```

**Pattern:** extract the raw value from `snapshot.stats`, format it, guard against
missing data.

```tsx
const stats = snapshot.stats
const myValue = typeof stats?.myField === 'number' ? stats.myField : null
const displayValue = myValue === null ? '—' : `${myValue} tokens`
```

Keep formatting logic in the component body, before the JSX. If the formatting is
non-trivial, extract a helper function at the bottom of the file.

## 5. (Optional) Change the input or send behavior

The input textarea and submit handler are the core of the composer. Changes here are
rare and high-impact — trace every caller of the modified handler before editing.

- **Input:** `<textarea>` at the top of the JSX. Handles paste, slash-commands,
  Enter-to-send, and character-by-character draft persistence.
- **Send:** `submit()` builds the final message, clears the draft, calls `onSend`, and
  restores the draft on failure.
- **Drafts:** persisted per session in `localStorage` under
  `pi-livecraft.composer-draft.<sessionId>`. Cleared on successful send.

## Files touched

| File | Action |
|---|---|
| `src/features/composer/Composer.tsx` | Add button, dropdown, or stat |
| `src/App.tsx` | (optional) New props or callbacks |
| `src/api.ts` | (optional) If the callback needs a new backend route |
