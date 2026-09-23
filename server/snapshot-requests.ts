import type { JsonObject, SnapshotRpcWaits } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'
import { modelDependency, type MetadataCache } from './features/session-metadata/metadata-cache.ts'

export interface SnapshotRpcMeasurements {
  waitsMs: SnapshotRpcWaits
  failedCommand?: keyof SnapshotRpcWaits
}

/** Starts independent RPCs together and observes every failure before awaiting dependent state. */
export async function loadSnapshotRequests(
  sessionId: string,
  command: (sessionId: string, request: JsonObject) => Promise<JsonObject>,
  metadata: MetadataCache,
  measurement: SnapshotRpcMeasurements = { waitsMs: {} },
) {
  async function measure<T>(name: keyof SnapshotRpcWaits, load: () => Promise<T>): Promise<T> {
    const started = performance.now()
    try {
      return await load()
    } catch (error) {
      measurement.failedCommand ??= name
      throw error
    } finally {
      measurement.waitsMs[name] = Math.round((performance.now() - started) * 100) / 100
    }
  }

  const [state, entries, stats, modelsResult, commandsResult, forkResult] = await Promise.all([
    measure('state', () => command(sessionId, { type: 'get_state' })),
    measure('entries', () => command(sessionId, { type: 'get_entries' })),
    measure('stats', () => command(sessionId, { type: 'get_session_stats' })),
    measure('models', () =>
      metadata.load(
        `models:${sessionId}`,
        async () => arrayData(await command(sessionId, { type: 'get_available_models' }), 'models'),
      )),
    measure('commands', () =>
      metadata.load(
        `commands:${sessionId}`,
        async () => arrayData(await command(sessionId, { type: 'get_commands' }), 'commands'),
      )),
    measure('fork', () =>
      metadata.load(
        `fork:${sessionId}`,
        async () => arrayData(await command(sessionId, { type: 'get_fork_messages' }), 'messages'),
      )),
  ])
  const stateData = objectData(state)
  const thinkingResult = await measure('thinking', () =>
    metadata.load(
      `thinking:${sessionId}`,
      async () =>
        stringArrayData(
          await command(sessionId, { type: 'get_available_thinking_levels' }),
          'levels',
        ),
      modelDependency(stateData?.model),
    ))
  const entriesData = objectData(entries)
  return {
    stateData,
    entries: arrayData(entries, 'entries'),
    leafId: entriesData?.leafId,
    stats: objectData(stats),
    models: modelsResult.value,
    commands: commandsResult.value,
    forkMessages: forkResult.value,
    thinkingLevels: thinkingResult.value,
    cacheHits: [modelsResult, commandsResult, forkResult, thinkingResult].map((item) =>
      item.cached
    ),
  }
}

function objectData(response: JsonObject): JsonObject | null {
  return isObject(response.data) ? response.data : null
}

function arrayData(response: JsonObject, key: string): JsonObject[] {
  if (!isObject(response.data) || !Array.isArray(response.data[key])) return []
  return response.data[key].filter(isObject)
}

function stringArrayData(response: JsonObject, key: string): string[] {
  if (!isObject(response.data) || !Array.isArray(response.data[key])) return []
  return response.data[key].filter((item): item is string => typeof item === 'string')
}
