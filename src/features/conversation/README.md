# Tool call presentations

Tool calls are displayed by `ToolCallCard` in `src/features/conversation/ToolCallCard.tsx`. The presentation is selected by `toolCallPresentation()` in `src/features/conversation/tool-calls.ts`.

By default, the tool header exposes its full title on hover. Once the call is resolved, its status displays the character counts of its serialized JSON arguments (`↘`) and raw text output (`↗`); these values remain available to hover and screen readers. Its output always shows a four-line preview; a click shows the full output, and the next click hides it. Read and written Markdown and code files are rendered in their appropriate format. Reading an HTML file opens it in the browser with its Windows path converted from WSL.

## Adding a presentation

Follow the [step-by-step guide](../../../docs/HOW-TO-TOOL-PRESENTATION.md). Return here for the default rendering rules above.

Add a presentation only when a tool genuinely provides information that is easier to understand in another form.
