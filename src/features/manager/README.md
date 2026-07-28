# Manager runtime notice

This feature owns only the persistent frontend notice for manager runtime status. The backend remains authoritative for revision comparison and restart eligibility; see the [manager lifecycle](/docs/MANAGER-LIFECYCLE.md).

`App` receives the `manager_status` SSE event and passes the validated shared status to `ManagerRuntimeNotice`. Routine `checking`, `current`, and error-free `disconnected` states stay hidden. The notice remains visible for an available update, an accepted restart, or a verification failure.

Restart requests go through `src/api.ts`. The component prevents duplicate clicks and disables the action while the selected session is active, but these are usability guards only: the manager reconciles each Pi process's live state and authoritatively rejects active or in-flight work. The restarting notice remains pending until the backend verifies a different manager instance with the expected revision.

Keep rendering and notice-specific styles in this directory. Cross-cutting SSE state stays in `App`; runtime detection and restart policy do not belong in the frontend.
