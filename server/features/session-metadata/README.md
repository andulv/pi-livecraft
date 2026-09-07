# Session metadata cache

Caches the rarely-changing metadata that snapshot assembly would otherwise re-fetch or
re-read on every warm settle. Implements plan task B4 with the freshness policy recorded
here; the policy table is the contract — code changes to the policy update this file first.

## Policy table

| Item | Key | Source | Dependencies | Invalidation triggers | Fallback expiry | Acceptable stale | Max retained | Cleanup owner |
|---|---|---|---|---|---|---|---|---|
| Models | `models:<sessionId>` | `get_available_models` RPC | loaded model set | state model change (deps mismatch); manager disconnect/reconnect; session exit/reassignment | 60 s | until the next snapshot for that session | 20 sessions (LRU) | cache LRU + lifecycle hooks in `server/backend.ts` |
| Commands | `commands:<sessionId>` | `get_commands` RPC | none observable | manager disconnect/reconnect; session exit/reassignment | 60 s | until the next snapshot | 20 sessions (LRU) | cache LRU + lifecycle hooks |
| Thinking levels | `thinking:<sessionId>` | `get_available_thinking_levels` RPC | model (deps string) | model change; manager disconnect/reconnect; session exit/reassignment | 60 s | until the next snapshot | 20 sessions (LRU) | cache LRU + lifecycle hooks |
| Fork messages | `fork:<sessionId>` | `get_fork_messages` RPC | none observable | manager disconnect/reconnect; session exit/reassignment | 60 s | until the next snapshot | 20 sessions (LRU) | cache LRU + lifecycle hooks |
| Prompt templates | `templates:<sessionId>` | `loadPromptTemplates` disk read | template files | `savePromptTemplate` invalidates the `templates:` prefix; manager disconnect/reconnect; session exit/reassignment | 60 s | until the next snapshot | 20 sessions (LRU) | cache LRU + save route + lifecycle hooks |

Not cached: `get_state`, `get_entries`, `get_session_stats` — they must stay fresh
(plan B4.1). Nothing here reduces Pi-side `get_entries` reads.

## Mechanics

- Loads are combined per key; concurrent snapshots share one in-flight fetch.
- Failed loads are never cached; the next request retries.
- An invalidation during an in-flight load blocks repopulation via per-key generations.
- Entries evicted by LRU beyond `maxSessions` (default 20), so sessions that stay live for
  days remain bounded.
- Backend restart starts empty; the cache is memory-only and content-free to this module.

## Measured effect

Warm-delta snapshot payloads fell from ~200 KB (metadata re-sent every settle) to
kilobytes; stage `templatesMs` drops to ~0 on cache hits. Coverage:
`test/metadata-cache.test.ts`.
