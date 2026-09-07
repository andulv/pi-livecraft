import type { SessionSnapshot, SessionSnapshotResponse } from '../../../shared/types.ts'

/**
 * Folds a snapshot response into the held snapshot. A delta keeps the previous
 * messages array reference when nothing was appended, so unchanged history never
 * re-renders consumers; a full response replaces everything.
 */
export function mergeSnapshotResponse(
  current: SessionSnapshot,
  response: SessionSnapshotResponse,
): SessionSnapshot {
  if (!('mode' in response) || response.mode !== 'delta') return response as SessionSnapshot
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
    stats: response.stats,
    liveEvents: response.liveEvents,
    cursor: response.cursor,
  }
}
