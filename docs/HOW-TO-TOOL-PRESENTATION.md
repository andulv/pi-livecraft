# Add a tool call presentation

This guide covers adding a visual presentation for an RPC tool in the conversation.
Every step is required unless noted otherwise. The `bash` presentation in
[`tool-calls.ts`](/src/features/conversation/tool-calls.ts) is the reference —
open it and locate `bashPresentation` to follow its shape.

## 1. Create the presentation function

Add a function in `src/features/conversation/tool-calls.ts`.

**Signature:** `(args: unknown, repositoryRoot?: string | null) => ToolCallPresentation`

**Contract:**
- `args` is `unknown` — always validate before accessing fields. Use `isObject()` to
  check that `args` is a JSON object.
- Return `{}` if arguments are invalid (silent fallback, nothing displayed).
- `headerDetail.text`: short version shown in the header (limit to ~80 chars via
  `truncateToolText`).
- `headerDetail.title`: full version for the tooltip and screen reader.
- `headerDetail.suffix`: optional, appended after the text (e.g. line range `[1:10]`).
- `pendingDetail`: optional, shown under the "In progress…" status.
- `repositoryRoot` lets you render absolute paths relative to the repo root via
  `pathFromRepositoryRoot`.

```ts
// src/features/conversation/tool-calls.ts

function myToolPresentation(args: unknown): ToolCallPresentation {
  if (!isObject(args) || typeof args.myField !== 'string') return {}

  const field = args.myField

  return {
    headerDetail: { text: truncateToolText(field, 80).text, title: field },
    pendingDetail: 'Waiting…',
  }
}
```

The function body is free-form: extract the fields you need, transform them, return the
presentation. Look at `bashPresentation` for the simple case, `filePresentation` for
relative paths, or `readPresentation` for enriching another presentation.

## 2. Register the presentation

Add an entry to the `toolCallPresentations` object with the **exact RPC tool name** as the
key (as sent by Pi in RPC events: `bash`, `read`, `write`, `edit`, `grep`, `find`, etc.):

```ts
const toolCallPresentations: Record<string, ToolCallPresenter> = {
  // … existing …
  my_tool: myToolPresentation,
}
```

## 3. Add a test

In `test/tool-calls.test.ts`, test through `toolCallPresentation()` (the public function that
resolves tool name → presentation). Cover two cases:

- **Valid arguments:** assert `headerDetail.text` and `.title` match the data
- **Invalid arguments:** test `{}`, `null`, or a missing field → `{}`

```ts
test('myToolPresentation shows the main field', () => {
  const presentation = toolCallPresentation({
    name: 'my_tool', id: 'call_1', args: { myField: 'value' },
  })
  assert.equal(presentation.headerDetail?.text, 'value')
  assert.equal(presentation.headerDetail?.title, 'value')
})

test('myToolPresentation ignores invalid arguments', () => {
  assert.deepEqual(
    toolCallPresentation({ name: 'my_tool', id: 'call_1', args: {} }),
    {},
  )
  assert.deepEqual(
    toolCallPresentation({ name: 'my_tool', id: 'call_1', args: null }),
    {},
  )
})
```

## Available utilities

| Function | Purpose |
|---|---|
| `truncateToolText(text, maxLength)` | Truncates with `…`, returns `{ text, truncated }` |
| `pathFromRepositoryRoot(path, root)` | Renders an absolute path relative to the repo root |
| `toolFilePath(args)` | Extracts `args.path` if present and valid |
| `isObject(value)` | Type guard `value is JsonObject` |

## Files touched

| File | Action |
|---|---|
| `src/features/conversation/tool-calls.ts` | Presentation function + entry in `toolCallPresentations` |
| `test/tool-calls.test.ts` | Test for the presentation and its fallback |

## Reference presentations

All in [`tool-calls.ts`](/src/features/conversation/tool-calls.ts):

- `bashPresentation` — simplest: a text field + `pendingDetail`
- `filePresentation` — repo-relative path via `pathFromRepositoryRoot`
- `readPresentation` — enriches `filePresentation` with a suffix (line range)
