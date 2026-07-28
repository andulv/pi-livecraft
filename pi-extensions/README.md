# Pi extensions

These extensions are loaded into every persistent Pi session started by Pi Livecraft. Disposable isolated prompts disable extensions unless their caller explicitly supplies paths:

- `ask-user-question.ts` registers the structured questionnaire tool and bridges its versioned payload through Pi's extension UI protocol.
- `quotas.ts` registers the private `/livecraft-quotas` command and publishes normalized provider usage through a versioned status payload.

`server/pi-process.ts` owns the extension paths. These modules use Pi's public extension API and shared protocols only; they do not define Pi Livecraft HTTP routes.

For requests displayed in the browser, keep the versioned payload parser in `shared/` and the UI-specific recognition and response flow in [`src/features/dialogs/`](/src/features/dialogs/README.md).
