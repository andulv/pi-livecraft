import type { JsonObject, SessionStats } from '../../../shared/types.ts'

/** Makes technical values readable in composer labels without changing RPC values. */
export function capitalizeLabel(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

export { isObject } from '../../../shared/is-object.ts'

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
}

/** Formats session cost and context-window usage for status display. */
export function formatSessionStats(stats: SessionStats | null): {
  assistantMessages: string
  cachePercent: string
  cost: string
  contextClass: string
  contextTokens: string
  contextPercent: string
  contextPercentValue: number | null
  inputTokens: string
  outputTokens: string
  toolCalls: string
  userMessages: string
} {
  const contextUsage = stats?.contextUsage
  const tokens = stats?.tokens
  const promptTokenParts = [tokens?.input, tokens?.cacheRead, tokens?.cacheWrite]
  const hasPromptTokens = promptTokenParts.some((value) => typeof value === 'number')
  const promptTokens = promptTokenParts.reduce<number>(
    (total, value) => total + (typeof value === 'number' ? value : 0),
    0,
  )
  const inputTokens = hasPromptTokens ? formatTokens(promptTokens) : '—'
  const outputTokens = typeof tokens?.output === 'number' ? formatTokens(tokens.output) : '—'
  // Cache reads are hits; writes are included in total prompt traffic but not in the hit numerator.
  const cachePercent = promptTokens > 0 && typeof tokens?.cacheRead === 'number'
    ? `${Math.round(tokens.cacheRead / promptTokens * 100)}%`
    : '—'
  const contextPercentValue = typeof contextUsage?.percent === 'number'
    ? Math.round(contextUsage.percent)
    : null
  const contextPercent = contextPercentValue === null ? '—' : `${contextPercentValue}%`
  const contextTokens = typeof contextUsage?.tokens === 'number'
      && typeof contextUsage.contextWindow === 'number'
    ? `${formatTokens(contextUsage.tokens)}/${formatTokens(contextUsage.contextWindow)}`
    : 'Unavailable'
  const cost = typeof stats?.cost === 'number' ? `$${stats.cost.toFixed(2)}` : '—'
  const contextClass = typeof contextUsage?.percent === 'number'
    ? contextUsage.percent >= 40
      ? 'context-danger'
      : contextUsage.percent >= 30
      ? 'context-warning-strong'
      : contextUsage.percent >= 20
      ? 'context-warning'
      : ''
    : ''
  const userMessages = typeof stats?.userMessages === 'number'
    ? formatTokens(stats.userMessages)
    : '—'
  const assistantMessages = typeof stats?.assistantMessages === 'number'
    ? formatTokens(stats.assistantMessages)
    : '—'
  const toolCalls = typeof stats?.toolCalls === 'number' ? formatTokens(stats.toolCalls) : '—'
  return {
    assistantMessages,
    cachePercent,
    cost,
    contextClass,
    contextTokens,
    contextPercent,
    contextPercentValue,
    inputTokens,
    outputTokens,
    toolCalls,
    userMessages,
  }
}

/** Returns true when the draft starts with a slash command exposed by Pi. */
export function isCommandDraft(text: string, commands: JsonObject[]): boolean {
  const name = /^\/([^\s]+)/.exec(text.trim())?.[1].toLowerCase()
  return name !== undefined
    && commands.some((command) => String(command.name).toLowerCase() === name)
}

/** Returns true when the trimmed draft is exactly the /compact slash command with no arguments. */
export function isCompactCommandDraft(text: string): boolean {
  return text.trim() === '/compact'
}

/** Returns true when the draft invokes the local /name command, with or without an argument. */
export function isNameCommandDraft(text: string): boolean {
  return /^\/name(?:\s|$)/i.test(text.trim())
}

/** Extracts the trimmed /name argument; empty when the draft has no argument. */
export function nameCommandArgument(text: string): string {
  return text.trim().replace(/^\/name/i, '').trim()
}

/** Prepends the local compact and name commands when Pi does not already expose them. */
export function ensureLocalCommands(commands: JsonObject[]): JsonObject[] {
  const names = new Set(commands.map((command) => String(command.name).toLowerCase()))
  const local: JsonObject[] = []
  if (!names.has('compact')) local.push({ name: 'compact' })
  if (!names.has('name')) local.push({ name: 'name', description: 'Rename this session' })
  return local.length === 0 ? commands : [...local, ...commands]
}

/** Restores the draft for one session from local storage. */
export function readComposerDraft(storageKey: string): string {
  try {
    const storage = (globalThis as typeof globalThis & {
      localStorage?: { getItem: (key: string) => string | null }
    })
      .localStorage
    return storage?.getItem(storageKey) ?? ''
  } catch {
    return ''
  }
}
