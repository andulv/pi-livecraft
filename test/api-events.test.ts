import assert from 'node:assert/strict'
import test from 'node:test'
import { parseManagerEvent } from '../src/api.ts'

test('parses a valid manager event', () => {
  const event = parseManagerEvent(JSON.stringify({
    kind: 'event',
    event: 'pi',
    sessionId: 'session-1',
    data: { type: 'agent_start' },
    sequence: 3,
  }))

  assert.deepEqual(event, {
    kind: 'event',
    event: 'pi',
    sessionId: 'session-1',
    data: { type: 'agent_start' },
    sequence: 3,
  })
  assert.deepEqual(
    parseManagerEvent(JSON.stringify({
      kind: 'event',
      event: 'session_reassigned',
      sessionId: 'session-1',
      data: { newSessionId: 'session-2' },
    })),
    {
      kind: 'event',
      event: 'session_reassigned',
      sessionId: 'session-1',
      data: { newSessionId: 'session-2' },
    },
  )
})

test('rejects malformed or unknown manager events', () => {
  assert.equal(parseManagerEvent('{'), null)
  assert.equal(
    parseManagerEvent(JSON.stringify({ kind: 'response', event: 'pi', sessionId: 'session-1' })),
    null,
  )
  assert.equal(
    parseManagerEvent(JSON.stringify({ kind: 'event', event: 'unknown', sessionId: 'session-1' })),
    null,
  )
  assert.equal(
    parseManagerEvent(JSON
      .stringify({ kind: 'event', event: 'pi', sessionId: 'session-1', sequence: -1 })),
    null,
  )
})
