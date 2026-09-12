import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyLlamaCppThinkingBudget,
  llamaCppProvider,
  llamaCppThinkingBudgetForLevel,
} from '../pi-extensions/llama-thinking-budgets-core.ts'

test('maps llama.cpp thinking levels to the configured token budgets', () => {
  assert.equal(llamaCppThinkingBudgetForLevel('low'), 512)
  assert.equal(llamaCppThinkingBudgetForLevel('medium'), 2048)
  assert.equal(llamaCppThinkingBudgetForLevel('high'), 4096)
  assert.equal(llamaCppThinkingBudgetForLevel('xhigh'), 8192)
  assert.equal(llamaCppThinkingBudgetForLevel('max'), 8192)
  assert.equal(llamaCppThinkingBudgetForLevel('off'), undefined)
})

test('rewrites only the configured llama.cpp provider payload', () => {
  const payload = {
    model: 'qwen38',
    chat_template_kwargs: { enable_thinking: true },
    thinking_budget_tokens: 2048,
  }

  assert.deepEqual(applyLlamaCppThinkingBudget(llamaCppProvider, 'low', payload), {
    ...payload,
    thinking_budget_tokens: 512,
  })
  assert.equal(applyLlamaCppThinkingBudget('other-provider', 'low', payload), undefined)
  assert.equal(applyLlamaCppThinkingBudget(llamaCppProvider, 'off', payload), undefined)
  assert.equal(
    applyLlamaCppThinkingBudget(llamaCppProvider, 'medium', {
      thinking_budget_tokens: 2048,
    }),
    undefined,
  )
})
