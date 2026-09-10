/**
 * Shared contract for the Pi settings editor.
 *
 * Pi keeps settings in two JSON files that merge, with the project file
 * overriding the global one: `~/.pi/agent/settings.json` (global) and
 * `<workspace>/.pi/settings.json` (project). Pi Livecraft reads and writes those
 * same files, so a value saved here also applies to the `pi` command line.
 *
 * The server publishes a curated field registry in every snapshot; the browser
 * renders whatever is published. Any key the registry does not model stays
 * editable through the raw-JSON editor and is preserved untouched on every write.
 */

export type PiSettingsScope = 'global' | 'project'

export type PiSettingValue = string | number | boolean | string[]

/** One curated setting rendered as a typed control. */
export interface PiSettingField {
  /** Dotted key path into settings.json, e.g. `"compaction.reserveTokens"`. */
  id: string
  label: string
  description: string
  /** Heading the field is grouped under in the form. */
  group: string
  type: 'string' | 'number' | 'boolean' | 'enum' | 'string-array'
  /** Allowed values when `type` is `enum`. */
  options?: string[]
  /** Inclusive lower bound when `type` is `number`. */
  minimum?: number
  /** Value Pi uses when nothing is stored, shown as a placeholder. */
  defaultValue?: PiSettingValue
  /** Only writable in the global file (e.g. `defaultProjectTrust`, `httpProxy`). */
  globalOnly?: boolean
}

/** One settings file and its parsed contents. */
export interface PiSettingsScopeDocument {
  scope: PiSettingsScope
  /** Absolute path, shown so users know where values live. */
  path: string
  /** Whether the file exists on disk. */
  exists: boolean
  /** Parsed document for this scope, or an empty object. */
  values: Record<string, unknown>
  /** Pretty-printed document text for the raw editor. */
  raw: string
}

export interface PiSettingsSnapshot {
  fields: PiSettingField[]
  scopes: PiSettingsScopeDocument[]
  /** Whether the project scope is available (a workspace is selected). */
  projectAvailable: boolean
  /**
   * Whether the project is trusted, when known. Left `undefined` until the
   * project-trust capability (see docs/PROJECT-TRUST.md) can supply it; the
   * untrusted banner shows only when this is explicitly `false`.
   */
  projectTrusted?: boolean
}

/** Reads a dotted key path from a parsed settings document. */
export function readSettingPath(values: Record<string, unknown>, id: string): unknown {
  const segments = id.split('.')
  let current: unknown = values
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
