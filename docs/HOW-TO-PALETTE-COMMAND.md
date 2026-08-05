# Add a palette command

This guide covers adding a command to the palette and keyboard shortcut system.
Every step is required. The `open-palette` command is the minimal reference.

## 1. Define the palette command

Add the identifier to `CoreCommandId` and the entry to `commandDefinitions`
(`src/features/commands/command-registry.ts`):

```ts
type CoreCommandId =
  // … existing …
  | 'my-command'

export const commandDefinitions: CommandDefinition[] = [
  // … existing …
  { id: 'my-command', label: 'My command' },
]
```

The identifier becomes available in `CommandId` and the palette command appears
with no further registration.

## 2. (Optional) Add a default shortcut

```ts
export const defaultShortcuts: Partial<Record<CommandId, string>> = {
  // … existing …
  'my-command': 'alt+shift+m',
}
```

Modifiers use the exact names `ctrl`, `meta`, `alt`, and `shift`. Normalization is handled by
`shortcutFromEvent`, which preserves the modifier pressed by the user. Do not use `mod` in new
values; it is retained only for migrating legacy shortcuts stored in `localStorage`. Palette
commands without a default shortcut remain assignable from Settings.

## 3. Implement execution

In `src/App.tsx`, add a case in the `executeCommand` function that handles the new
identifier. Locate the existing pattern (`if (id === '...') { …; return }`) and add
yours after it.

## 4. (Optional) Make the palette command conditional

If the palette command only makes sense in certain contexts (active session, loaded
data…), add its disable condition in the `useMemo` of `paletteCommands` (`src/App.tsx`).
Find the `disabled` field in the `commandDefinitions` mapping and add your condition
alongside `unavailableWidget` and the `['send', 'abort', …]` block.

A disabled palette command remains visible but grayed out and non-clickable.

## 5. (Optional) Cover in tests

Add a test in `test/shortcuts.test.ts` if the palette command introduces new
normalization, shortcut conflict, or resolution behavior. For a simple command, a
registry presence test is enough:

```ts
test('my-command is recognized by the registry', () => {
  const definition = commandDefinitions.find((d) => d.id === 'my-command')
  assert.ok(definition)
  assert.equal(definition.label, 'My command')
})
```

## Files touched

| File | Action |
|---|---|
| `src/features/commands/command-registry.ts` | `CoreCommandId`, `commandDefinitions`, (optional) `defaultShortcuts` |
| `src/App.tsx` | `executeCommand`, (optional) disable in `paletteCommands` |
| `test/shortcuts.test.ts` | (optional) Registry test |
