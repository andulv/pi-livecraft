import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assistantMessageAfterEvent,
  assistantMessageInEvent,
} from '../shared/assistant-message-stream.ts'

test('assembles assistant text from RPC streaming deltas', () => {
  let message = assistantMessageInEvent({
    type: 'message_start',
    message: { role: 'assistant', content: [] },
  })

  for (
    const event of [
      { type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } },
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello ' },
      },
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'world' },
      },
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Hello world' },
      },
    ]
  ) message = assistantMessageAfterEvent(message, event)

  assert.deepEqual(message, {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello world' }],
  })
})
