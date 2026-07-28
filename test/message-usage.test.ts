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

test('maps observed per-message durations to their message index by ordinal', () => {
  const messages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'response', usage: { input: 100, output: 10, cacheRead: 1_000, cost: { total: 0.01 } } },
    { role: 'user', content: 'continue' },
    { role: 'assistant', content: 'done', usage: { input: 200, output: 20, cacheRead: 2_000, cost: { total: 0.02 } } },
  ]
  const durations = new Map([[1, 1_250], [2, 830]])
  assert.deepEqual(turnDurationByMessage(messages, durations), new Map([[1, 1_250], [3, 830]]))
})

test('matches durations after historical turns', () => {
  const messages = [
    { role: 'assistant', content: 'history 1', usage: { input: 10, output: 1, cacheRead: 100, cost: { total: 0.001 } } },
    { role: 'assistant', content: 'history 2', usage: { input: 20, output: 2, cacheRead: 200, cost: { total: 0.002 } } },
    { role: 'assistant', content: 'current 1', usage: { input: 30, output: 3, cacheRead: 300, cost: { total: 0.003 } } },
    { role: 'assistant', content: 'current 2', usage: { input: 40, output: 4, cacheRead: 400, cost: { total: 0.004 } } },
  ]
  assert.deepEqual(turnDurationByMessage(messages, new Map([[3, 1_250], [4, 830]])), new Map([[2, 1_250], [3, 830]]))
})

test('skips assistant messages without usage and ignores non-assistant roles', () => {
  const messages = [
    { role: 'assistant', content: 'no usage here' },
    { role: 'user', content: 'not an assistant' },
    { role: 'assistant', content: 'with usage', usage: { input: 50, output: 5, cacheRead: 500, cost: { total: 0.005 } } },
  ]
  // Only the third message has usage, so it's ordinal 1.
  assert.deepEqual(turnDurationByMessage(messages, new Map([[1, 500]])), new Map([[2, 500]]))
  // No matching ordinal in the map.
  assert.deepEqual(turnDurationByMessage(messages, new Map([[2, 999]])), new Map())
  // Empty durations map.
  assert.deepEqual(turnDurationByMessage(messages, new Map()), new Map())
})
