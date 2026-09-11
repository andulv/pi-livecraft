import { match } from 'node:assert/strict'
import { test } from 'node:test'
import { composeSubagentPrompt } from '../pi-extensions/shub-agents/define.ts'

test('shared prompt states the exact selected limits and report semantics', () => {
  const prompt = composeSubagentPrompt(
    'Agent instructions.',
    'quick',
    { timeoutMs: 45_000, softToolCalls: 6, hardToolCalls: 8 },
    4_000,
  )

  match(prompt, /Timeout: 45000 ms/)
  match(prompt, /soft target: 6/)
  match(prompt, /hard ceiling: 8/)
  match(prompt, /Final report limit: 4000 characters/)
  match(prompt, /limits only the report, not how much evidence you may read/)
})
