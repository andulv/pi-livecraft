# Extension dialogs

This feature presents UI requests emitted by Pi extensions and sends their responses back to the
owning session. `App.tsx` owns the cross-session queue and decides which request is visible;
`Dialogs.tsx` owns rendering and response state for the selected request.

## Protocol boundary

- `App.tsx` receives `extension_ui_request` events and retains pending requests by session.
- `dialog-protocol.ts` recognizes supported request shapes and identifies blocking dialogs.
- `Dialogs.tsx` responds through `sendPiCommand(..., { type: 'extension_ui_response', ... })`.
- Generic Pi extension requests keep their public RPC fields. The Livecraft questionnaire uses the
  versioned parser in `shared/ask-user-question.ts`.
- `pi-extensions/ask-user-question.ts` creates that questionnaire payload; browser-specific logic
  must not move into the extension.

Unknown or malformed specialized payloads must not be treated as questionnaires. Keep validation
in the shared parser so the extension and frontend agree on the same versioned contract. Main
coverage: `test/ask-user-question.test.ts`.
