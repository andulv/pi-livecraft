# Session environment backend capability

`EnvironmentService` coordinates manager commands, concurrent refresh deduplication, restart restoration, and session availability. `EnvironmentCache` validates the versioned extension status payload — including optional extension source paths, estimated tool-definition character counts, and skill provenance — and keeps the last valid value of each section when a newer report omits it: session start publishes tools before a command context can read the system-prompt options, so context files arrive with a later refresh instead of blanking the tool list.

HTTP paths and session identifier validation remain in `server/backend.ts`. Pi communication always uses `ManagerClient`. Main coverage: `test/session-environment.test.ts`.
