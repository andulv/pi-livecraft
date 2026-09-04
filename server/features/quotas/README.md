# Quotas backend capability

`QuotaService` coordinates manager commands, concurrent refresh deduplication, restart restoration, and session availability. `QuotaCache` validates the versioned extension status payload and retains the last valid provider data when a refresh fails. `POST /api/quotas/reset` redeems one banked Codex or Z.AI reset through the extension's `/livecraft-quotas-reset` command, then confirms success only when the extension's normal refreshed report shows the relevant banked-reset count fell. Z.AI cards additionally require the local ZCode sign-in credentials, which the extension reads and decrypts itself.

HTTP paths and session identifier validation remain in `server/backend.ts`. Pi communication always uses `ManagerClient`. Main coverage: `test/quotas.test.ts`.
