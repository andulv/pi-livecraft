# Add a widget

This guide covers adding a widget to the right sidebar. Every step is required unless noted
otherwise. The [`TodoWidget`](/src/features/todo/TodoWidget.tsx) is the reference
implementation — open it alongside and follow its shape.

## 1. Create the component

Add a directory `src/features/<widget>/` with the main component.

The component receives cross-feature data through **props** passed from `App.tsx` via
`RightSidebar.tsx`. Data owned only by the widget may be loaded inside the component, but every
network request must use a function from `src/api.ts`.

```tsx
// src/features/<widget>/<Widget>.tsx

export function MyWidget({ workspacePath }: { workspacePath: string }) {
  // Local UI and feature-owned data belong here.
  // Cross-feature state and actions arrive through props.
}
```

**Constraints:**
- The active panel is rendered conditionally from the rail; switching widgets can unmount it. Keep state that must survive switching in `App.tsx`, `localStorage`, or backend persistence.
- Persistence uses `localStorage` (`pi-livecraft.` prefix) on the frontend, or a
  `server/features/<widget>/` module on the backend
- CSS classes live in `src/features/<widget>/<widget>.css`

## 2. Register the widget

Add an entry to `rightWidgetDefinitions` (`src/features/right-sidebar/right-sidebar.ts`):

```ts
{ id: 'my-widget', label: 'My widget' },
```

**This single entry automatically creates:**
- An `open-widget-my-widget` command in the palette
- An assignable keyboard shortcut in Settings

To customize the auto-created palette command (shortcut, conditional availability,
execution behavior), follow the [palette command guide](/docs/HOW-TO-PALETTE-COMMAND.md)
starting from step 2.

No other registration is needed.

## 3. Wire into RightSidebar.tsx

In `src/features/right-sidebar/RightSidebar.tsx`:

- **Panel:** add a conditional render on `activeWidget`, following the pattern of existing
  widgets (search for `activeWidget === 'todo'` in the file). Forward the props received
  by `RightSidebar`.
- **Rail:** add a button inside `<div className="right-sidebar-rail">`, copying the
  accessibility pattern (`aria-controls`, `aria-expanded`, `aria-label`) and the
  `onWidgetSelect` call. If the widget is conditional, wrap the button in a guard.
- **`panelLabel`:** add an entry in the same-named function for the accessible label.

## 4. (Optional) Forward props from App.tsx

If the widget needs cross-feature data or callbacks owned by `App.tsx`:

- Add the props to `RightSidebar`'s interface
- Pass them in the `<RightSidebar>` render in `App.tsx`
- Forward them to the component in the panel (step 3)

## 5. (Optional) Backend data

If the widget consumes backend data:

### 5a. API function

```ts
// src/api.ts
export async function getMyWidgetData(cwd: string): Promise<MyDataType> {
  return request<MyDataType>(`/api/my-widget?cwd=${encodeURIComponent(cwd)}`)
}
```

### 5b. Backend route

```ts
// server/backend.ts
if (method === 'GET' && url.pathname === '/api/my-widget') {
  const rawCwd = url.searchParams.get('cwd')
  if (!rawCwd) throw new HttpError(400, 'Working directory is required')
  const cwd = await resolveWorkingDirectory(rawCwd)
  const data = await getMyWidgetData(cwd)
  sendJson(response, 200, data)
  return
}
```

### 5c. Shared types

```ts
// shared/types.ts
export interface MyDataType {
  // …
}
```

### 5d. Backend module (for business logic)

```ts
// server/features/my-widget/my-widget.ts
export async function getMyWidgetData(cwd: string): Promise<MyDataType> {
  // Business logic, file access, etc.
}
```

Backend modules do not expose HTTP routes — that responsibility stays in `server/backend.ts`.

## Utility component: WidgetLayout

`WidgetLayout` (`src/features/right-sidebar/WidgetLayout.tsx`) provides an optional structure
with a fixed header and scrollable content area:

```tsx
<WidgetLayout header={<div><strong>My widget</strong><span>subtitle</span></div>}>
  {/* scrollable content */}
</WidgetLayout>
```

Used by the session analysis widget, but not mandatory.

## Files touched

| File | Action |
|---|---|
| `src/features/<widget>/<Widget>.tsx` | Create the component |
| `src/features/right-sidebar/right-sidebar.ts` | Add to `rightWidgetDefinitions` |
| `src/features/right-sidebar/RightSidebar.tsx` | Panel, rail, `panelLabel` |
| `src/App.tsx` | (optional) Props and callbacks |
| `src/api.ts` | (optional) Request function |
| `server/backend.ts` | (optional) HTTP route |
| `shared/types.ts` | (optional) Types |
| `server/features/<widget>/` | (optional) Backend logic |

## Reference widget

[`TodoWidget`](/src/features/todo/TodoWidget.tsx) illustrates feature-owned state, calls through
`src/api.ts`, error handling, and backend persistence.
