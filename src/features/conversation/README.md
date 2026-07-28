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

By default, the tool header exposes its full title on hover. Once the call is resolved, its status displays the character counts of its serialized JSON arguments (`↘`) and raw text output (`↗`); these values remain available to hover and screen readers. Its output always shows a four-line preview; a click shows the full output, and the next click hides it. Read and written Markdown and code files are rendered in their appropriate format. Reading an HTML file opens it in the browser with its Windows path converted from WSL.

Follow the [step-by-step guide](/docs/HOW-TO-TOOL-PRESENTATION.md) before adding a presentation. Add one only when a tool genuinely provides information that is easier to understand in another form.
