import type {
  SessionSnapshot,
  SessionSnapshotResponse,
  SessionStats,
} from '../../../shared/types.ts'

/**
 * Folds a snapshot response into the held snapshot. A delta keeps the previous
 * messages array reference when nothing was appended, so unchanged history never
 * re-renders consumers; a full response replaces everything.
 */
export function mergeSnapshotResponse(
  current: SessionSnapshot,
  response: SessionSnapshotResponse,
): SessionSnapshot {
  if (!('mode' in response) || response.mode !== 'delta') {
    const snapshot = response as SessionSnapshot
    return { ...snapshot, stats: mergeSessionStats(current.stats, snapshot.stats) }
  }
  const messages = response.appended.length > 0
    ? [...current.messages, ...response.appended]
    : current.messages
  return {
    state: response.state,
    messages,
    models: response.models,
    thinkingLevels: response.thinkingLevels,
    responseControls: response.responseControls,
    commands: response.commands,
    promptTemplates: response.promptTemplates,
    stats: mergeSessionStats(current.stats, response.stats),
    liveEvents: response.liveEvents,
    cursor: response.cursor,
  }
}

function mergeSessionStats(
  current: SessionStats | null,
  next: SessionStats | null,
): SessionStats | null {
  if (!current) return next
  if (!next) return current
  return {
    ...next,
    userMessages: Math.max(current.userMessages ?? 0, next.userMessages ?? 0),
    assistantMessages: Math.max(current.assistantMessages ?? 0, next.assistantMessages ?? 0),
    toolCalls: Math.max(current.toolCalls ?? 0, next.toolCalls ?? 0),
    toolResults: Math.max(current.toolResults ?? 0, next.toolResults ?? 0),
    totalMessages: Math.max(current.totalMessages ?? 0, next.totalMessages ?? 0),
    cost: Math.max(current.cost ?? 0, next.cost ?? 0),
    tokens: {
      ...next.tokens,
      input: Math.max(current.tokens?.input ?? 0, next.tokens?.input ?? 0),
      output: Math.max(current.tokens?.output ?? 0, next.tokens?.output ?? 0),
      cacheRead: Math.max(current.tokens?.cacheRead ?? 0, next.tokens?.cacheRead ?? 0),
      cacheWrite: Math.max(current.tokens?.cacheWrite ?? 0, next.tokens?.cacheWrite ?? 0),
    },
  }
}
