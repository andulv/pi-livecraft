import { homedir } from 'node:os'
import { join } from 'node:path'

export const MAX_REPORT_CHARS = 100_000

export interface SubagentEffort {
  timeoutMs: number
  softToolCalls: number
  hardToolCalls: number
}

export type SubagentTool =
  | 'read'
  | 'edit'
  | 'write'
  | 'bash'
  | 'grep'
  | 'find'
  | 'ls'
  | 'fffind'
  | 'ffgrep'
  | 'codex-research'
  | 'codex-search'

export interface SubagentDefinition<
  TArguments extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string
  description: string
  promptSnippet?: string
  promptGuidelines?: readonly string[]
  parameters: { properties: Record<string, unknown> }
  task: (args: TArguments) => string
  systemPrompt: string
  tools: readonly SubagentTool[]
  /** Extra extension entry files loaded into the child; the child loads no other extensions. */
  extensions?: readonly string[]
  /** Extra CLI flags and environment this agent's toolchain needs inside the child. */
  providerArgs?: readonly string[]
  providerEnv?: Readonly<Record<string, string>>
  model: string
  thinking: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  effort: Readonly<Record<string, SubagentEffort>>
  defaultEffort: string
  maxOutputChars: number
  images?: boolean
}

/** Entry file of an installed user package, resolved from Pi's agent home (`PI_CODING_AGENT_DIR` or `~/.pi/agent`). */
export function agentPackageEntry(packageName: string, entryPath: string): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
  return join(agentDir, 'npm', 'node_modules', packageName, entryPath)
}

/** Gives an agent definition schema-derived argument types without registering it. */
export function defineSubagent<TArguments extends Record<string, unknown>>(
  definition: SubagentDefinition<TArguments>,
): SubagentDefinition<TArguments> {
  return definition
}

/** Adds the shared run limits without making each agent repeat them. */
export function composeSubagentPrompt(
  systemPrompt: string,
  effortName: string,
  effort: SubagentEffort,
  maxOutputChars: number,
): string {
  return `${systemPrompt.trim()}

Run limits:
- Effort: ${effortName}.
- Timeout: ${effort.timeoutMs} ms.
- Tool-call soft target: ${effort.softToolCalls}. At or before this target, stop expanding scope and synthesize unless one essential evidence gap remains.
- Tool-call hard ceiling: ${effort.hardToolCalls}. Further calls are blocked; if blocked, synthesize immediately from the evidence already collected.
- Final report limit: ${maxOutputChars} characters. This limits only the report, not how much evidence you may read.
- Return one complete, standalone report after the last tool call.`
}
