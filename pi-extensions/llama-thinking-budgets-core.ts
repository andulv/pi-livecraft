import { isObject } from '../shared/is-object.ts'
import type { JsonObject } from '../shared/types.ts'

/** Provider configured for the local Qwen llama.cpp deployment. */
export const llamaCppProvider = 'catherder-llama'

/**
 * llama.cpp receives a per-request token budget rather than Pi's abstract effort
 * string. Keep this override at the provider-payload boundary so xhigh can have
 * its own budget even though Pi's built-in settings currently collapse xhigh/max
 * onto the high budget.
 */
export const llamaCppThinkingBudgets: Readonly<Record<string, number>> = {
  low: 512,
  medium: 2048,
  high: 4096,
  xhigh: 8192,
  max: 8192,
}

export function llamaCppThinkingBudgetForLevel(level: string | undefined): number | undefined {
  return level === undefined ? undefined : llamaCppThinkingBudgets[level]
}

/** Returns a replacement payload, or undefined when this request is unchanged. */
export function applyLlamaCppThinkingBudget(
  provider: string | undefined,
  level: string | undefined,
  payload: unknown,
): JsonObject | undefined {
  if (provider !== llamaCppProvider || !isObject(payload)) return undefined

  const budget = llamaCppThinkingBudgetForLevel(level)
  if (budget === undefined || payload.thinking_budget_tokens === budget) return undefined

  return { ...payload, thinking_budget_tokens: budget }
}
