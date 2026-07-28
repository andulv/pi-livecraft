# Add a tool call presentation

This guide covers adding a visual presentation for an RPC tool in the conversation.
Every step is required unless noted otherwise. The `bash` presentation in
[`tool-call-presentations/bash.ts`](/src/features/conversation/tool-call-presentations/bash.ts)
is the reference — open it to follow its shape.

## 1. Create the presentation module

Add a new `.ts` file in `src/features/conversation/tool-call-presentations/`.

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
- Types and shared helpers (`ToolCallPresentation`, `ToolCallPresenter`,
  `truncateToolText`, `pathFromRepositoryRoot`, `readLineRange`, `positiveInteger`)
  are available from `./shared.ts`.

```ts
// src/features/conversation/tool-call-presentations/my-tool.ts

import { isObject } from '../../../../shared/is-object.ts'
import { truncateToolText, type ToolCallPresentation } from './shared.ts'

export function myToolPresentation(args: unknown): ToolCallPresentation {
  if (!isObject(args) || typeof args.myField !== 'string') return {}

  const field = args.myField

  return {
    headerDetail: { text: truncateToolText(field, 80).text, title: field },
    pendingDetail: 'Waiting…',
  }
}
```

The function body is free-form: extract the fields you need, transform them, return the
presentation. Look at `bash.ts` for the simple case, `file.ts` for
relative paths, or `read.ts` for enriching another presentation.

## 2. Register the presentation

Add an entry to the `toolCallPresentations` object in
[`tool-call-presentations/index.ts`](/src/features/conversation/tool-call-presentations/index.ts)
with the **exact RPC tool name** as the key (as sent by Pi in RPC events: `bash`, `read`,
`write`, `edit`, `grep`, `find`, etc.):

```ts
export const toolCallPresentations: Record<string, ToolCallPresenter> = {
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

| Function | Location | Purpose |
|---|---|---|
| `truncateToolText(text, maxLength)` | `tool-call-presentations/shared.ts` | Truncates with `…`, returns `{ text, truncated }` |
| `pathFromRepositoryRoot(path, root)` | `tool-call-presentations/shared.ts` | Renders an absolute path relative to the repo root |
| `readLineRange(args)` | `tool-call-presentations/shared.ts` | Formats validated `offset` and `limit` arguments |
| `positiveInteger(value)` | `tool-call-presentations/shared.ts` | Validates a positive safe integer |
| `isObject(value)` | `shared/is-object.ts` | Type guard `value is Record<string, unknown>` |

## Files touched

| File | Action |
|---|---|
| `src/features/conversation/tool-call-presentations/<tool>.ts` | New presentation module |
| `src/features/conversation/tool-call-presentations/index.ts` | Entry in `toolCallPresentations` |
| `test/tool-calls.test.ts` | Test for the presentation and its fallback |

## Reference presentations

Every presentation lives in [`src/features/conversation/tool-call-presentations/`](/src/features/conversation/tool-call-presentations/):

- [`bash.ts`](/src/features/conversation/tool-call-presentations/bash.ts) — simplest: a text field + `pendingDetail`
- [`file.ts`](/src/features/conversation/tool-call-presentations/file.ts) — repo-relative path via `pathFromRepositoryRoot`, shared by `edit` and `write`
- [`read.ts`](/src/features/conversation/tool-call-presentations/read.ts) — enriches `file.ts` with a line-range suffix
- [`search.ts`](/src/features/conversation/tool-call-presentations/search.ts) — pattern with optional directory, shared by `find` and `grep`
