import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activityAfterSnapshot,
  activityForPiEvent,
  activityText,
  connectingCause,
  sessionActivity,
  sessionStatusAfterSnapshot,
} from '../src/features/conversation/activity.ts'

test('keeps a current activity through thinking, tool preparation, execution, and writing', () => {
  let activity = activityForPiEvent(null, { type: 'agent_start' })
  assert.deepEqual(activity, { kind: 'working' })

  activity = activityForPiEvent(activity, {
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_start' },
  })
  activity = activityForPiEvent(activity, {
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', delta: '**Inspecting** files' },
  })
  assert.deepEqual(activity, { kind: 'thinking', thinking: '**Inspecting** files' })

  activity = activityForPiEvent(activity, {
    type: 'message_update',
    assistantMessageEvent: { type: 'toolcall_start' },
  })
  assert.deepEqual(activity, { kind: 'tool-preparing' })

  activity = activityForPiEvent(activity, { type: 'tool_execution_start', toolName: 'read' })
  assert.deepEqual(activity, { kind: 'tool-waiting' })

  activity = activityForPiEvent(activity, { type: 'tool_execution_end' })
  assert.deepEqual(activity, { kind: 'working' })

  assert.equal(
    activityText({ kind: 'tool-preparing' }, 'worker'),
    'Worker is preparing a tool call…',
  )
  assert.equal(activityText({ kind: 'tool-waiting' }, 'worker'), 'Worker is waiting for the tool…')
  assert.equal(activityText(activity, 'worker'), 'Worker is getting things moving…')
  assert.equal(
    activityText({ kind: 'thinking', thinking: '**Inspecting** files' }, undefined),
    'Pi is thinking hard…',
  )

  activity = activityForPiEvent(activity, {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'Done' },
  })
  assert.deepEqual(activity, { kind: 'writing' })
  assert.equal(activityForPiEvent(activity, { type: 'agent_settled' }), null)
})

test('keeps thinking content out of the activity label', () => {
  let activity = activityForPiEvent(null, {
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_start' },
  })
  activity = activityForPiEvent(activity, {
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', delta: '**Inspecting** files\n' },
  })
  activity = activityForPiEvent(activity, {
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', delta: '**Checking** tests' },
  })

  assert.deepEqual(activity, {
    kind: 'thinking',
    thinking: '**Inspecting** files\n**Checking** tests',
  })
  assert.equal(activityText(activity, undefined), 'Pi is thinking hard…')
})

test('reports compaction until Pi continues or settles', () => {
  const compacting = activityForPiEvent({ kind: 'working' }, {
    type: 'compaction_start',
    reason: 'threshold',
  })

  assert.deepEqual(compacting, { kind: 'compacting' })
  assert.equal(activityText(compacting, 'pi'), 'Pi is compacting the session…')
  assert.deepEqual(
    activityForPiEvent(compacting, { type: 'compaction_end', reason: 'threshold' }),
    { kind: 'working' },
  )
})

test('reports provider reconnection attempts', () => {
  const activity = activityForPiEvent({ kind: 'working' }, {
    type: 'auto_retry_start',
    attempt: 2,
    maxAttempts: 3,
  })

  assert.deepEqual(activity, { kind: 'retrying', attempt: 2, maxAttempts: 3 })
  assert.equal(activityText(activity, 'pi'), 'Pi is reconnecting to the provider (2/3)…')
})

test('restores reliable activity from connection and session status', () => {
  assert.deepEqual(sessionActivity(null, 'idle', 'connecting'), { kind: 'connecting' })
  assert.equal(sessionActivity(null, 'idle', 'connected'), null)
  assert.deepEqual(sessionActivity(null, 'running', 'connected'), { kind: 'working' })
  assert.deepEqual(sessionActivity({ kind: 'writing' }, 'running', 'disconnected'), {
    kind: 'disconnected',
  })
  assert.deepEqual(sessionActivity(null, 'exited', 'connected'), { kind: 'exited' })
  assert.deepEqual(sessionActivity({ kind: 'compacting' }, 'idle', 'connected'), {
    kind: 'compacting',
  })
})

test('distinguishes the two causes of a lingering connection cable', () => {
  assert.equal(connectingCause('idle', 'connecting'), 'backend-stream')
  assert.equal(connectingCause('starting', 'connected'), 'session-starting')
  assert.equal(connectingCause('starting', 'connecting'), 'backend-stream')
  assert.equal(connectingCause('idle', 'connected'), undefined)
})

test('a settled snapshot clears stale thinking after missed completion events', () => {
  const thinking = { kind: 'thinking' as const, thinking: 'Old work' }
  assert.equal(activityAfterSnapshot(thinking, { isStreaming: false }, []), null)
  assert.deepEqual(activityAfterSnapshot(thinking, { isStreaming: true }, []), {
    kind: 'working',
  })
  assert.deepEqual(activityAfterSnapshot(thinking, { isCompacting: true }, []), {
    kind: 'compacting',
  })
  assert.equal(activityAfterSnapshot(thinking, null, []), thinking)
})

test('Pi state reconciles a session status even when its settle event was missed', () => {
  assert.equal(sessionStatusAfterSnapshot({ isStreaming: false }), 'idle')
  assert.equal(sessionStatusAfterSnapshot({ isStreaming: true }), 'running')
  assert.equal(sessionStatusAfterSnapshot({ isStreaming: false, isCompacting: true }), 'running')
  assert.equal(sessionStatusAfterSnapshot(null), undefined)
})

test('an active snapshot reconstructs activity from the current turn', () => {
  const liveEvents = [{
    sequence: 9,
    data: { type: 'message_update', assistantMessageEvent: { type: 'text_delta' } },
  }]
  assert.deepEqual(activityAfterSnapshot(null, { isStreaming: true }, liveEvents), {
    kind: 'writing',
  })
})

test('uses playful activity labels', () => {
  assert.equal(activityText({ kind: 'disconnected' }, 'pi'), 'Pi is off the radar 📡')
  assert.equal(activityText({ kind: 'writing' }, 'pi'), 'Pi is writing…')
})
