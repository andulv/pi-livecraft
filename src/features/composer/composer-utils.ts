import type { JsonObject } from '../../../shared/types.ts'

/** Makes technical values readable in composer labels without changing RPC values. */
export function capitalizeLabel(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function formatTokens(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
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

/** Restores the draft for one session, falling back to the legacy key for migration. */
export function readComposerDraft(storageKey: string): string {
  try {
    const storage = (globalThis as typeof globalThis & { localStorage?: { getItem: (key: string) => string | null } }).localStorage
    return storage?.getItem(storageKey) ?? storage?.getItem(storageKey.replace('pi-livecraft.composer-draft.', 'pi-workbench.composer-draft.')) ?? ''
  } catch {
    return ''
  }
}
