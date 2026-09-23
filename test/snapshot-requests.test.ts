import assert from 'node:assert/strict'
import test from 'node:test'
import { MetadataCache } from '../server/features/session-metadata/metadata-cache.ts'
import { loadSnapshotRequests, type SnapshotRpcMeasurements } from '../server/snapshot-requests.ts'
import type { JsonObject } from '../shared/types.ts'

test('loads independent snapshot RPCs and then model-dependent thinking levels', async () => {
  const calls: string[] = []
  const measurement: SnapshotRpcMeasurements = { waitsMs: {} }
  const result = await loadSnapshotRequests(
    'session-a',
    async (_sessionId, command) => {
      calls.push(String(command.type))
      const data: Record<string, JsonObject> = {
        get_state: { model: { provider: 'test', id: 'model' }, isStreaming: false },
        get_entries: { entries: [{ id: 'one' }], leafId: 'one' },
        get_session_stats: { totalMessages: 1 },
        get_available_models: { models: [{ id: 'model' }] },
        get_commands: { commands: [{ name: 'command' }] },
        get_fork_messages: { messages: [{ entryId: 'one' }] },
        get_available_thinking_levels: { levels: ['off', 'high'] },
      }
      return { data: data[String(command.type)] }
    },
    new MetadataCache(),
    measurement,
  )

  assert.deepEqual(result.stateData, {
    model: { provider: 'test', id: 'model' },
    isStreaming: false,
  })
  assert.deepEqual(result.entries, [{ id: 'one' }])
  assert.equal(result.leafId, 'one')
  assert.deepEqual(result.stats, { totalMessages: 1 })
  assert.deepEqual(result.models, [{ id: 'model' }])
  assert.deepEqual(result.commands, [{ name: 'command' }])
  assert.deepEqual(result.forkMessages, [{ entryId: 'one' }])
  assert.deepEqual(result.thinkingLevels, ['off', 'high'])
  assert.deepEqual(result.cacheHits, [false, false, false, false])
  assert.deepEqual(
    new Set(calls.slice(0, 6)),
    new Set([
      'get_state',
      'get_entries',
      'get_session_stats',
      'get_available_models',
      'get_commands',
      'get_fork_messages',
    ]),
  )
  assert.equal(calls[6], 'get_available_thinking_levels')
  assert.deepEqual(
    Object.keys(measurement.waitsMs).sort(),
    [
      'state',
      'entries',
      'stats',
      'models',
      'commands',
      'fork',
      'thinking',
    ]
      .sort(),
  )
  assert.ok(Object.values(measurement.waitsMs).every((duration) => duration >= 0))
})

test('observes an early session failure while other RPCs are still pending', async () => {
  const failure = new Error('Unknown session')
  const measurement: SnapshotRpcMeasurements = { waitsMs: {} }
  await assert.rejects(
    loadSnapshotRequests(
      'session-a',
      async (_sessionId, command) => {
        if (command.type === 'get_entries') throw failure
        if (command.type === 'get_available_models')
          await new Promise<void>((resolve) => setTimeout(resolve, 10))
        return { data: {} }
      },
      new MetadataCache(),
      measurement,
    ),
    failure,
  )
  assert.equal(measurement.failedCommand, 'entries')
  // Node's test runner also fails this test if a detached RPC rejects as unhandled.
  await new Promise<void>((resolve) => setTimeout(resolve, 20))
})
