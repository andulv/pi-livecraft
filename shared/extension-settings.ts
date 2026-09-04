/**
 * Shared contract for Pi extension settings.
 *
 * The values live in one document inside Pi's agent directory
 * (`~/.pi/agent/extension-settings.json`), which the extensions themselves
 * populate with their published definitions. Pi Livecraft reads and writes that
 * same document, so a value saved here also applies to the `pi` command line.
 */

export type ExtensionSettingValue = string | number | boolean

/** One user-configurable setting published by an extension. */
export interface ExtensionSettingDefinition {
  id: string
  label: string
  description?: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  /** Allowed values when `type` is `enum`. */
  options?: string[]
  /** Inclusive lower bound when `type` is `number`. */
  minimum?: number
  /** Value used when nothing is stored and no environment override applies. */
  defaultValue?: ExtensionSettingValue
  /** Environment variable that takes precedence over the stored value. */
  env?: string
  /** When a saved value becomes visible: the next call, or only after a reload. */
  effect?: 'next-call' | 'reload-required'
  /** Machine-specific or diagnostic setting, rendered behind an advanced group. */
  advanced?: boolean
}

/** Settings published by one extension. */
export interface ExtensionSettingGroup {
  name: string
  description?: string
  settings: ExtensionSettingDefinition[]
}

/** An environment variable that currently overrides a stored value. */
export interface ExtensionSettingOverride {
  extension: string
  id: string
  env: string
}

export interface ExtensionSettingsSnapshot {
  /** Absolute path of the shared document, shown so users know where values live. */
  path: string
  groups: ExtensionSettingGroup[]
  /** Stored values per extension and setting id. */
  values: Record<string, Record<string, ExtensionSettingValue>>
  overrides: ExtensionSettingOverride[]
}
