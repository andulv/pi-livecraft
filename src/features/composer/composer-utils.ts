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

/** Restores the draft for one session, falling back to the legacy key for migration. */
export function readComposerDraft(storageKey: string): string {
  try {
    return window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(storageKey.replace('pi-livecraft.composer-draft.', 'pi-workbench.composer-draft.')) ?? ''
  } catch {
    return ''
  }
}
