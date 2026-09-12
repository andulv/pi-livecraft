import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { applyLlamaCppThinkingBudget } from './llama-thinking-budgets-core.ts'

export default function registerLlamaCppThinkingBudgets(pi: ExtensionAPI): void {
  pi.on(
    'before_provider_request',
    (event, ctx) =>
      applyLlamaCppThinkingBudget(ctx.model?.provider, ctx.thinkingLevel, event.payload),
  )
}
