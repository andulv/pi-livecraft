# Manager runtime notice

`ManagerRuntimeNotice` renders the cross-cutting status received by `App` through the SSE `manager_status` event. It never infers freshness from browser state: `server/manager-runtime-monitor.ts` owns revision comparison and restart eligibility.

The restart action goes through `src/api.ts`. The notice remains pending until the backend verifies a different manager instance with the expected runtime revision. Active sessions disable the action in the UI; the backend checks its session snapshot and the manager authoritatively rejects any active or in-flight work.
