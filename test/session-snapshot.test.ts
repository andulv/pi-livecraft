import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeSessionMessages,
  LiveSessionEvents,
  sliceSnapshotDelta,
  snapshotCursor,
  visibleSessionMessages,
} from '../server/session-snapshot.ts'

test('retains only the events needed to restore active thinking and tools', () => {
  const live = new LiveSessionEvents()
  live.receive({ type: 'agent_start' }, 1)
  live.receive({ type: 'message_start', message: { role: 'assistant', content: [] } }, 2)
  live.receive({
    type: 'message_update',
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Inspecting' }] },
    assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting' },
  }, 3)
  live.receive({
    type: 'message_update',
    message: {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Inspecting' }, {
        type: 'toolCall',
        id: 'call-1',
        name: 'read',
        arguments: {},
      }],
    },
    assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1 },
  }, 4)
  live.receive(
    { type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'read', args: {} },
    5,
  )
  live.receive({
    type: 'tool_execution_update',
    toolCallId: 'call-1',
    toolName: 'read',
    partialResult: { content: 'partial' },
  }, 6)

  assert.deepEqual(live.snapshot().map(({ sequence }) => sequence), [1, 2, 4, 5, 6])

  live.receive({ type: 'message_end' }, 7)
  assert.deepEqual(live.snapshot().map(({ sequence }) => sequence), [1, 5, 6])
  live.receive({ type: 'tool_execution_end', toolCallId: 'call-1' }, 8)
  assert.deepEqual(live.snapshot().map(({ sequence }) => sequence), [1])
  live.receive({ type: 'agent_settled' }, 9)
  assert.deepEqual(live.snapshot(), [])
})

test('retains the latest steering queue for snapshot replay', () => {
  const live = new LiveSessionEvents()
  live.receive({ type: 'queue_update', steering: ['First'] }, 1)
  live.receive({ type: 'queue_update', steering: ['First', 'Second'] }, 2)

  assert.deepEqual(live.snapshot(), [{
    data: { type: 'queue_update', steering: ['First', 'Second'] },
    sequence: 2,
  }])

  live.receive({ type: 'agent_settled' }, 3)
  assert.deepEqual(live.snapshot(), [])
})

test('stores an assembled assistant message for delta-only replay', () => {
  const live = new LiveSessionEvents()
  live.receive({ type: 'message_start', message: { role: 'assistant', content: [] } }, 1)
  live.receive({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
  }, 2)
  live.receive({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello ' },
  }, 3)
  live.receive({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'world' },
  }, 4)

  assert.deepEqual(live.snapshot().at(-1)?.data.message, {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello world' }],
  })
})

test('keeps the active conversation before and after compaction', () => {
  const messages = activeSessionMessages([
    {
      type: 'message',
      id: 'user-1',
      parentId: null,
      message: { role: 'user', content: 'Original request' },
    },
    {
      type: 'message',
      id: 'assistant-1',
      parentId: 'user-1',
      message: { role: 'assistant', content: 'Original response' },
    },
    {
      type: 'message',
      id: 'abandoned',
      parentId: 'user-1',
      message: { role: 'assistant', content: 'Abandoned branch' },
    },
    { type: 'compaction', id: 'compact-1', parentId: 'assistant-1', summary: 'Summary' },
    {
      type: 'message',
      id: 'user-2',
      parentId: 'compact-1',
      message: { role: 'user', content: 'Continue' },
    },
  ], 'user-2')

  assert.deepEqual(messages, [
    { entryId: 'user-1', role: 'user', content: 'Original request' },
    { entryId: 'assistant-1', role: 'assistant', content: 'Original response' },
    {
      entryId: 'compact-1',
      role: 'custom',
      customType: 'compaction',
      content: 'Summary',
      display: true,
    },
    { entryId: 'user-2', role: 'user', content: 'Continue' },
  ])
})

test('stamps assistant messages with the thinking level recorded before them', () => {
  const messages = activeSessionMessages(
    [
      {
        type: 'message',
        id: 'user-1',
        parentId: null,
        message: { role: 'user', content: 'First' },
      },
      {
        type: 'message',
        id: 'assistant-1',
        parentId: 'user-1',
        message: { role: 'assistant', content: 'Before any switch', model: 'm' },
      },
      {
        type: 'thinking_level_change',
        id: 'level-1',
        parentId: 'assistant-1',
        thinkingLevel: 'high',
      },
      {
        type: 'message',
        id: 'assistant-2',
        parentId: 'level-1',
        message: { role: 'assistant', content: 'After the switch', model: 'm' },
      },
      {
        type: 'message',
        id: 'assistant-3',
        parentId: 'assistant-2',
        message: {
          role: 'assistant',
          content: 'Native level wins',
          model: 'm',
          thinkingLevel: 'max',
        },
      },
    ],
    'assistant-3',
  )

  assert.deepEqual(messages.map((message) => message.thinkingLevel), [
    undefined, // the user message
    undefined, // generated before any thinking_level_change entry
    'high',
    'max', // a native level on the message itself wins over the stamp
  ])
})

test('marks forkable user messages by entry ID instead of duplicated text', () => {
  const messages = activeSessionMessages(
    [
      {
        type: 'message',
        id: 'user-1',
        parentId: null,
        message: { role: 'user', content: 'Repeat this' },
      },
      {
        type: 'message',
        id: 'assistant-1',
        parentId: 'user-1',
        message: { role: 'assistant', content: 'Done' },
      },
      {
        type: 'message',
        id: 'user-2',
        parentId: 'assistant-1',
        message: { role: 'user', content: 'Repeat this' },
      },
    ],
    'user-2',
    new Set(['user-2', 'assistant-1']),
  )

  assert.deepEqual(messages, [
    { entryId: 'user-1', role: 'user', content: 'Repeat this' },
    { entryId: 'assistant-1', role: 'assistant', content: 'Done' },
    { entryId: 'user-2', role: 'user', content: 'Repeat this', forkEntryId: 'user-2' },
  ])
})

test('filters compaction entries without a string summary', () => {
  const messages = activeSessionMessages([
    { type: 'message', id: 'user-1', parentId: null, message: { role: 'user', content: 'Hello' } },
    { type: 'compaction', id: 'compact-1', parentId: 'user-1', summary: 42 },
    {
      type: 'message',
      id: 'user-2',
      parentId: 'compact-1',
      message: { role: 'user', content: 'World' },
    },
  ], 'user-2')

  assert.deepEqual(messages, [
    { entryId: 'user-1', role: 'user', content: 'Hello' },
    { entryId: 'user-2', role: 'user', content: 'World' },
  ])
})

test('keeps visible custom messages out of hidden extension context', () => {
  const visible = { role: 'custom', customType: 'status', content: 'Prêt', display: true }
  const hidden = {
    role: 'custom',
    customType: 'secret-context',
    content: 'Interne',
    display: false,
  }

  assert.deepEqual(
    visibleSessionMessages([
      { role: 'user', content: 'Bonjour' },
      visible,
      hidden,
      { role: 'custom', content: 'Type manquant', display: true },
      { role: 'branchSummary', summary: 'Résumé' },
    ]),
    [
      { role: 'user', content: 'Bonjour' },
      visible,
    ],
  )
})

test('stamps each visible message with its snapshot entry id', () => {
  const messages = activeSessionMessages(
    [
      { type: 'message', id: 'e1', message: { role: 'user', content: 'Hello' } },
      { type: 'thinking_level_change', id: 'e2', parentId: 'e1', thinkingLevel: 'high' },
      { type: 'message', id: 'e3', parentId: 'e2', message: { role: 'assistant', content: [] } },
    ],
    'e3',
  )

  assert.deepEqual(messages.map(({ entryId }) => entryId), ['e1', 'e3'])
  assert.equal(snapshotCursor(messages), '2:e3')
})

test('appends only messages newer than a valid cursor', () => {
  const messages = activeSessionMessages(
    [
      { type: 'message', id: 'e1', message: { role: 'user', content: 'Hello' } },
      { type: 'message', id: 'e2', parentId: 'e1', message: { role: 'assistant', content: [] } },
    ],
    'e2',
  )

  const delta = sliceSnapshotDelta(messages, '1:e1')
  assert.equal(delta.mode, 'delta')
  assert.deepEqual(delta.mode === 'delta' && delta.appended, [messages[1]])
  assert.equal(delta.cursor, '2:e2')
})

test('reports an empty delta when the client already holds the full history', () => {
  const messages = activeSessionMessages(
    [{ type: 'message', id: 'e1', message: { role: 'user', content: 'Hello' } }],
    'e1',
  )

  const delta = sliceSnapshotDelta(messages, snapshotCursor(messages))
  assert.equal(delta.mode, 'delta')
  assert.deepEqual(delta.mode === 'delta' && delta.appended, [])
})

test('falls back to a full snapshot for unknown, moved, or oversized cursors', () => {
  const messages = activeSessionMessages(
    [
      { type: 'message', id: 'e1', message: { role: 'user', content: 'Hello' } },
      { type: 'message', id: 'e2', parentId: 'e1', message: { role: 'assistant', content: [] } },
    ],
    'e2',
  )

  assert.equal(sliceSnapshotDelta(messages, '2:zzz').mode, 'full')
  assert.equal(sliceSnapshotDelta(messages, '3:e2').mode, 'full')
  assert.equal(sliceSnapshotDelta(messages, '1:e2').mode, 'full')
  assert.equal(sliceSnapshotDelta(messages, 'junk').mode, 'full')
  assert.equal(sliceSnapshotDelta(messages, '0:').mode, 'full')
})

test('falls back to a full snapshot after history shrinks behind the cursor', () => {
  const shrunk = activeSessionMessages(
    [{ type: 'message', id: 'e2', message: { role: 'assistant', content: [] } }],
    'e2',
  )

  assert.equal(sliceSnapshotDelta(shrunk, '2:e2').mode, 'full')
})
