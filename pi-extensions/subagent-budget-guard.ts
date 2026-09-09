/**
 * Tool-call budget for a subagent child run.
 *
 * Loaded only into the child Pi process started by `research.ts`. The parent
 * passes the budget through the environment because a child receives its
 * configuration on the command line and through env, never through the settings
 * document. The soft target is prompt guidance; this guard enforces the hard
 * ceiling, which is what stops a large-context model from exploring forever.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const hardLimit = Number(process.env.PI_SUBAGENT_HARD_TOOL_CALLS || 0)
const softTarget = Number(process.env.PI_SUBAGENT_SOFT_TOOL_CALLS || 0)

export default function subagentBudgetGuard(pi: ExtensionAPI): void {
  let toolCalls = 0

  pi.on('tool_call', () => {
    toolCalls++
    if (hardLimit > 0 && toolCalls > hardLimit) {
      return {
        block: true,
        reason: `Tool budget exhausted (${hardLimit} calls; soft target ${softTarget || 'unset'}). `
          + 'Do not call more tools. Immediately synthesize the evidence already collected and '
          + 'clearly note any remaining uncertainty.',
      }
    }
    return undefined
  })
}
