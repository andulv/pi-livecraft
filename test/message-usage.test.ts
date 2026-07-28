import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTurnCost, messageUsage, turnDurationByMessage, turnUsageByMessage } from '../src/features/conversation/message-usage.ts'

test('extracts per-response cost and token counters from Pi usage', () => {
  const usage = messageUsage({
    role: 'assistant',
    usage: {
      input: 12_345,
      output: 678,
      cacheRead: 9_876,
      cost: { total: 0.00105 },
    },
  })

  assert.deepEqual(usage, { cacheMiss: 12_345, cacheRead: 9_876, cacheWrite: 0, cost: 0.00105, output: 678 })
  assert.equal(formatTurnCost(usage?.cost ?? 0), '$0.0011')
})

test('keeps usage separate for each agentic turn', () => {
  const usages = turnUsageByMessage([
    { role: 'user', content: 'Inspecte le dépôt.' },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Je cherche les fichiers.' },
        { type: 'toolCall', id: 'call_1', name: 'read' },
        { type: 'toolCall', id: 'call_2', name: 'grep' },
      ],
      usage: { input: 100, output: 10, cacheRead: 1_000, cost: { total: 0.001 } },
    },
    { role: 'toolResult', toolCallId: 'call_1' },
    { role: 'toolResult', toolCallId: 'call_2' },
    { role: 'assistant', content: [{ type: 'text', text: 'C’est fait.' }], usage: { input: 200, output: 20, cacheRead: 2_000, cost: { total: 0.002 } } },
  ])

  assert.deepEqual([...usages], [
    [1, { cacheMiss: 100, cacheRead: 1_000, cacheWrite: 0, cost: 0.001, output: 10 }],
    [4, { cacheMiss: 200, cacheRead: 2_000, cacheWrite: 0, cost: 0.002, output: 20 }],
  ])
})

test('hides metrics when Pi does not provide complete usage', () => {
  assert.equal(messageUsage({ role: 'assistant', usage: { input: 10 } }), null)
  assert.deepEqual(turnUsageByMessage([
    { role: 'user' },
    { role: 'assistant', usage: { input: 10 } },
  ]), new Map())
})

test('maps observed per-message durations to their message index by timestamp', () => {
  const messages = [
    { role: 'user', timestamp: 100, content: 'hello' },
    { role: 'assistant', timestamp: 200, content: 'response' },
    { role: 'user', timestamp: 300, content: 'continue' },
    { role: 'assistant', timestamp: 400, content: 'done' },
  ]
  const durations = new Map([[200, 1_250], [400, 830]])
  assert.deepEqual(turnDurationByMessage(messages, durations), new Map([[1, 1_250], [3, 830]]))
})

test('skips messages without a timestamp or without an observed duration', () => {
  const messages = [
    { role: 'assistant', content: 'no timestamp here' },
    { role: 'assistant', timestamp: 500, content: 'unmeasured' },
    { role: 'user', timestamp: 600, content: 'not an assistant' },
  ]
  assert.deepEqual(turnDurationByMessage(messages, new Map()), new Map())
  assert.deepEqual(turnDurationByMessage(messages, new Map([[700, 500]])), new Map())
})
