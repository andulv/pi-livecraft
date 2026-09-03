# Session index widget

Session index is a compact navigation list for the selected Pi conversation. It shows only user messages, in chronological order, so requests remain easy to scan without assistant output or tool activity obscuring them.

Each user message opens a turn. The entry also keeps the **final assistant response** of that turn as a muted, single-line preview — preferring its first Markdown heading, otherwise its first meaningful line — so a turn stays recognizable without listing every assistant message, tool call, or tool result. Turns still in progress (no assistant text yet) show no preview. Clicking an entry scrolls to and highlights the user message; the assistant response remains directly below it in the conversation.

Entries additionally summarize what the agent did during the turn: assistant turn count, tool calls (failures noted in parentheses), billed input and output tokens (input totals include cached reads, which are shown as a percentage), and the turn duration — shown in parentheses next to the entry's timestamp, formatted in minutes and seconds. Durations prefer the telemetry measured during the current Pi Livecraft run and otherwise fall back to the span between the user message and the turn's last recorded activity, so reopened sessions still show timings. The summary also lists the model and reasoning effort used, recorded at each switch point within the turn (`older → newer`).

The widget derives its entries directly from the current conversation snapshot. Each entry retains the original message index and sends a `message` navigation target back to `App.tsx`; `Conversation.tsx` then mounts history as needed, scrolls to the matching message, and highlights it. The widget makes no API calls and does not persist feature state.

Image-only and empty user messages remain represented with a clear fallback label. Until the selected session snapshot arrives, the widget displays a loading state instead of stale messages from a previous session.

`SessionIndexWidget` owns presentation. `session-index.ts` owns the pure snapshot-to-entry transformation. Focused coverage: `test/session-index.test.ts`.
