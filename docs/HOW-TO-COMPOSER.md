# Modify the composer

This guide covers adding a toolbar button, dropdown, or session stat to the composer.
Every step is required unless noted otherwise. Open
[`Composer.tsx`](/src/features/composer/Composer.tsx) alongside and follow its shape.

## Project structure

```
composer/
├── Composer.tsx              # Form, textarea, images, send/stop, assembly
├── composer.css              # All composer styles
├── composer-images.ts        # Image paste, resize, compress
├── composer-utils.ts         # capitalizeLabel, formatTokens, readComposerDraft
├── prompt-title.ts           # Immediate session title
├── selects/
│   ├── ComposerSelect.tsx    # Generic Radix Select wrapper + icon
│   ├── AgentSelect.tsx       # Agent picker (props → RPC)
│   ├── ModelSelect.tsx       # Model picker (snapshot → RPC)
│   ├── PromptSelect.tsx      # Prompt template preview, insertion, and saving
│   ├── ThinkingSelect.tsx    # Thinking level picker (snapshot → RPC)
│   └── BehaviorSelect.tsx    # Steer / Follow-up (running only)
└── status-bar/
    ├── ComposerStatusBar.tsx # Layout container
    ├── SessionInfo.tsx       # Name, cwd, active dot
    └── SessionStats.tsx      # Cost, context usage + progress bar
```

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
| `onImprovePrompt(prompt, direction)` | Rewrite the draft through an isolated prompt |
| `onSavePrompt(scope, name, content)` | Persist a prompt template globally or for the project |
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
- Use the `.icon-button` class for consistent sizing. Add `.danger` for destructive
  actions.

**Props and App.tsx wiring (optional):**

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

Dropdowns live in `selects/`. Each is a standalone component built on
[`ComposerSelect`](/src/features/composer/selects/ComposerSelect.tsx), the generic
Radix Select wrapper.

**Create the select component:**

```tsx
// src/features/composer/selects/MySelect.tsx

import { ComposerSelect } from './ComposerSelect.tsx'

export function MySelect({ value, onChange }: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <ComposerSelect
      ariaLabel="My option"
      onValueChange={onChange}
      options={[
        { label: 'First', value: 'first' },
        { label: 'Second', value: 'second' },
      ]}
      placeholder="Choose…"
      tone="agent"
      value={value}
    />
  )
}
```

**Wire it in `Composer.tsx`:**

```tsx
// Inside <div className="composer-tools">
<MySelect value={myValue} onChange={handleChange} />
```

**`ComposerSelect` props:**

| Prop | Notes |
|---|---|
| `ariaLabel` | Required for accessibility |
| `options` | `{ label, value, description?, kind? }[]` (`kind: 'action'` marks an action option) |
| `value` | Currently selected value (controlled) |
| `onValueChange` | Called with the new value |
| `onOptionPointerMove` / `onOptionsPointerLeave` | (optional) Preview option content while browsing |
| `loading` | (optional) Shows a spinner in the trigger |
| `tone` | `'agent'`, `'model'`, `'thinking'`, `'behavior'`, `'command'`, `'prompt'`, or `'improve'` — sets the icon and color |
| `disabled` | (optional) Greys out the select |
| `open` / `onOpenChange` | (optional) For external open control (palette-triggered selects) |
| `triggerRef` | (optional) For focusing the trigger from outside |

Wrap `onCommand()` calls in `void … .catch(onError)` — the composer doesn't own error
display.

## 4. Add a session stat

Stats live in [`status-bar/SessionStats.tsx`](/src/features/composer/status-bar/SessionStats.tsx).
Each stat is a `<span>` with a `<b>` label and inline content.

**Add a stat to `SessionStats`:**

```tsx
// In SessionStats.tsx, after the existing <span> entries
<span>
  <b>My stat</b>
  {myFormattedValue}
</span>
```

**Derive the value in `Composer.tsx` and forward it:**

Add a prop to `SessionStats`, derive the formatted value in `Composer.tsx` before the
JSX, and pass it through `ComposerStatusBar`.

```tsx
const myValue = typeof snapshot.stats?.myField === 'number' ? snapshot.stats.myField : null
const displayValue = myValue === null ? '—' : `${myValue} tokens`

// Pass to ComposerStatusBar, which forwards to SessionStats
```

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
| `src/features/composer/Composer.tsx` | Add button, wire new select, or derive stat value |
| `src/features/composer/selects/<Select>.tsx` | (optional) New select component |
| `src/features/composer/status-bar/SessionStats.tsx` | (optional) New stat entry |
| `src/App.tsx` | (optional) New props or callbacks |
| `src/api.ts` | (optional) If the callback needs a new backend route |
