# Quotas backend capability

`QuotaService` coordinates manager commands, concurrent refresh deduplication, restart restoration, and session availability. `QuotaCache` validates the versioned extension status payload and retains the last valid provider data when a refresh fails. `POST /api/quotas/reset` redeems one banked Codex reset through the extension's `/livecraft-quotas-reset` command; the consume endpoint is undocumented, so its response codes map to the outcome the HTTP route returns.

HTTP paths and session identifier validation remain in `server/backend.ts`. Pi communication always uses `ManagerClient`. Main coverage: `test/quotas.test.ts`.
