# Session index widget

Session index is a compact navigation list for the selected Pi conversation. It shows only user messages, in chronological order, so requests remain easy to scan without assistant output or tool activity obscuring them.

The widget derives its entries directly from the current conversation snapshot. Each entry retains the original message index and sends a `message` navigation target back to `App.tsx`; `Conversation.tsx` then mounts history as needed, scrolls to the matching message, and highlights it. The widget makes no API calls and does not persist feature state.

Image-only and empty user messages remain represented with a clear fallback label. Until the selected session snapshot arrives, the widget displays a loading state instead of stale messages from a previous session.

`SessionIndexWidget` owns presentation. `session-index.ts` owns the pure snapshot-to-entry transformation. Focused coverage: `test/session-index.test.ts`.
