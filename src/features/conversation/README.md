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

## Contextual conversation actions

Messages and tool calls expose contextual actions through explicit composition rather than a registry. `DefaultMessageCard` in `Conversation.tsx` owns actions on ordinary messages; `ToolCallCard.tsx` owns actions on tool calls. Both reuse the `.conversation-actions` styles in `conversation.css`, which reveal actions on hover or keyboard focus and keep them visible on touch devices. Unknown custom messages rendered by `DefaultCustomMessage` do not currently expose this surface.

`CopyButton.tsx` is the current shared action implementation, not the extension contract. It uses the browser Clipboard API, reports failures through `onError`, and exposes its accessible label through the shared `Tooltip` component.

- Text messages expose one copy action when `visibleText()` returns content.
- Tool calls always expose their serialized input (`↘`) and expose raw output (`↗`) once a result exists, including error results.
- Pending calls have no output action. Directional markers distinguish tool actions without visible button text.

Follow the [conversation action guide](/docs/HOW-TO-CONVERSATION-ACTION.md) to add another action. Keep actions icon-only, keyboard-accessible, colocated with their owning content, and explicit in the relevant renderer. Do not introduce a registry unless actions need genuinely dynamic selection.
