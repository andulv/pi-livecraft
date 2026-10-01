import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSessionRefreshBatcher,
  sessionEventRefreshWindowMs,
} from '../src/features/workspace/session-refresh-batch.ts'

test('a burst of session events refreshes the session list once per window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const causes: string[] = []
  const batcher = createSessionRefreshBatcher((cause) => causes.push(cause))

  batcher.schedule('sessions:manager_connected')
  for (let index = 0; index < 5; index++) batcher.schedule('sessions:session_created')
  assert.deepEqual(causes, [])
  t.mock.timers.tick(sessionEventRefreshWindowMs)
  assert.deepEqual(causes, ['sessions:manager_connected'])

  batcher.schedule('sessions:session_created')
  t.mock.timers.tick(sessionEventRefreshWindowMs)
  assert.deepEqual(causes, ['sessions:manager_connected', 'sessions:session_created'])

  batcher.schedule('sessions:session_reassigned')
  batcher.cancel()
  t.mock.timers.tick(sessionEventRefreshWindowMs)
  assert.equal(causes.length, 2)
})
