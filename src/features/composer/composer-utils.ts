import type { JsonObject, SessionStats } from '../../../shared/types.ts'

/** Makes technical values readable in composer labels without changing RPC values. */
export function capitalizeLabel(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

export { isObject } from '../../../shared/is-object.ts'

export function formatTokens(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
}

/** Formats session cost and context-window usage for status display. */
export function formatSessionStats(stats: SessionStats | null): {
  cost: string
  contextClass: string
  contextTokens: string
  contextPercent: string
  contextPercentValue: number | null
} {
  const contextUsage = stats?.contextUsage
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
  return { cost, contextClass, contextTokens, contextPercent, contextPercentValue }
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

/** Prepends the local compact command when Pi does not already expose it in the snapshot. */
export function ensureCompactCommand(commands: JsonObject[]): JsonObject[] {
  return commands.some((cmd) => String(cmd.name).toLowerCase() === 'compact')
    ? commands
    : [{ name: 'compact' }, ...commands]
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
