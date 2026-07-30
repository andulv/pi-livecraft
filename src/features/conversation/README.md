# Conversation

`useConversationRuntime` owns state for the selected Pi conversation: snapshots, streamed messages, steering queue reconciliation, activity, tool execution updates, observed durations, event sequences, and replay of snapshot `liveEvents`. It rejects stale snapshot responses and batches assistant deltas with `requestAnimationFrame`.

`App.tsx` keeps only cross-feature Pi effects such as session status, dialogs, Git refreshes, quotas, and notifications. Live and replayed events pass through that orchestration before reaching the runtime so their ordering and sequence deduplication remain consistent.

Pure protocol, reconciliation, and display rules stay separate:

- `tool-protocol.ts` interprets tool calls and execution updates;
- `message-reconciliation.ts` merges history with live messages;
- `tool-presentation.ts` and `tool-call-presentations/` describe tool-specific display;
- `event-sequence.ts` accepts new sequence numbers and rejects duplicates.

## Tool call presentations

Tool calls are displayed by `ToolCallCard` in `src/features/conversation/ToolCallCard.tsx`. The presentation is selected by `toolCallPresentation()` in `src/features/conversation/tool-presentation.ts`.

By default, the tool header exposes its full title on hover. Once the call is resolved, its status displays the character counts of its serialized JSON arguments (`↘`) and raw text output (`↗`); these values remain available to hover and screen readers. Code and text files show a four-line preview; a click expands the full output. HTML, SVG, and Markdown files are rendered directly in the card (HTML in a sandboxed iframe, SVG as an image, Markdown via React-Markdown); a "View source" label toggles to syntax-highlighted code with line numbers. Markdown previews and their source views are capped at 380px with vertical scroll; HTML and SVG previews and their source views are capped at 540px.

Follow the [step-by-step guide](/docs/HOW-TO-TOOL-PRESENTATION.md) before adding a presentation. Add one only when a tool genuinely provides information that is easier to understand in another form.

## Conversation copy actions

`CopyButton.tsx` provides the shared copy action for visible conversation content. The action
is available on hover or keyboard focus for messages and tool calls, and remains visible on
touch devices. It uses the browser Clipboard API, reports failures through the conversation
error handler, and exposes its label through the shared `Tooltip` component.

- Text messages expose one copy action when visible text exists.
- Tool calls expose the serialized input (`↘`) and, once a result exists, the raw output (`↗`).
  Output remains copyable for error results; pending calls have no output action.
- Directional markers distinguish the two tool actions without adding visible button text.

Keep these actions icon-only, accessible by keyboard, and colocated with their owning content.
Reuse `CopyButton` rather than duplicating clipboard state or tooltip behavior.
