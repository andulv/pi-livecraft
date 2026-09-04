# Quotas backend capability

`QuotaService` coordinates manager commands, concurrent refresh deduplication, restart restoration, and session availability. `QuotaCache` validates versioned extension statuses and retains the last valid provider data when a refresh fails. `POST /api/quotas/reset` redeems one banked Codex or Z.AI reset through the extension's `/livecraft-quotas-reset` command; Pi's prompt acknowledgement has no command return data, so the extension publishes a correlated reset-outcome status after its post-redemption refresh. Codex accepts an otherwise unrecognized successful consume response only when that fresh report proves the banked-reset count decreased. Z.AI cards additionally require the local ZCode sign-in credentials, which the extension reads and decrypts itself.

HTTP paths and session identifier validation remain in `server/backend.ts`. Pi communication always uses `ManagerClient`. Main coverage: `test/quotas.test.ts`.
