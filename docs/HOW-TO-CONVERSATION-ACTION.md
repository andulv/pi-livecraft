# Add a conversation action

This guide covers adding an icon action to an ordinary message or a tool call. Conversation actions are composed explicitly in their owning renderer; there is no action registry.

Use [`CopyButton.tsx`](/src/features/conversation/CopyButton.tsx) as the reference when an action needs local asynchronous state, error reporting, and a changing tooltip. A simple action can remain local to its renderer.

## 1. Choose the owning surface

Ordinary messages and tool calls have separate data contracts:

| Surface | Composition point | Available data |
|---|---|---|
| Ordinary message | `DefaultMessageCard` in [`MessageCard.tsx`](/src/features/conversation/MessageCard.tsx) | Message object and visible text returned by `visibleText()` |
| Tool call | `ToolCallCard` in [`ToolCallCard.tsx`](/src/features/conversation/ToolCallCard.tsx) | Name, arguments, pending/resolved state, raw result, and error state |

Add the action only to the surface that owns the required data. Unknown custom messages use `DefaultCustomMessage` and do not currently expose contextual actions.

Tool call presentations are a different extension point: they format tool-specific header and body content but do not own actions. Follow the [tool presentation guide](/docs/HOW-TO-TOOL-PRESENTATION.md) when only the display should change.

## 2. Compose the action

Place the button inside the renderer's existing container:

```tsx
<div className='conversation-actions message-actions'>
  {/* Action button */}
</div>
```

Tool calls use the same `conversation-actions` class with `tool-call-actions`. Keep selection explicit in `DefaultMessageCard` or `ToolCallCard`; do not add a registry for a fixed action.

Create a neighboring component only when the action has reusable behavior or state. Report failures through the renderer's `onError` callback instead of creating notification state inside the action.

## 3. Preserve interaction contracts

Every conversation action must:

- use a native `button` with `type='button'`;
- have an accessible label and remain keyboard-operable;
- use the shared [`Tooltip`](/src/components/README.md) when the icon has no visible text;
- avoid appearing when the required value is unavailable;
- remain colocated with the content it affects;
- preserve the shared hover, focus, touch, and reduced-motion behavior in `conversation-actions.css`.

For tool calls, do not offer a result action before `hasResult` is true. Error results still have raw output and may expose result actions.

## 4. Validate the change

Run:

```bash
npm run typecheck
npm run lint
```

Check the affected surface with keyboard focus and pointer hover, then in a touch-sized viewport. Verify unavailable actions are absent, failures reach the conversation error handler, and icon-only buttons expose their label to assistive technology. Add one focused test when the action introduces non-trivial extraction, availability, or transformation logic.

## Files commonly touched

| File | Purpose |
|---|---|
| `src/features/conversation/MessageCard.tsx` | Ordinary message action composition |
| `src/features/conversation/ToolCallCard.tsx` | Tool call action composition |
| `src/features/conversation/<Action>.tsx` | Optional reusable stateful action |
| `src/features/conversation/conversation-actions.css` | Shared action layout only when the existing container is insufficient |
| `test/<focused-test>.test.ts` | Non-trivial pure behavior |
