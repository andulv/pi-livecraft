/**
 * Reads and writes the Pi extension settings document that the extensions
 * publish to `~/.pi/agent/extension-settings.json`.
 *
 * The document is self-describing: each extension publishes its own setting
 * definitions, so this module renders and validates whatever is published
 * without knowing any extension by name. Writing here is the same write the
 * `pi` command line performs through `/extension-settings`, which keeps both
 * surfaces on one value.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isObject } from '../../../shared/is-object.ts'
import type {
  ExtensionSettingDefinition,
  ExtensionSettingOverride,
  ExtensionSettingsSnapshot,
  ExtensionSettingValue,
} from '../../../shared/extension-settings.ts'

/** Reported for an invalid update or a settings document that cannot be used. */
export class ExtensionSettingsError extends Error {}

const DOCUMENT_NAME = 'extension-settings.json'

interface SettingsDocument {
  definitions: Record<string, { description?: string; settings: ExtensionSettingDefinition[] }>
  values: Record<string, Record<string, ExtensionSettingValue>>
}

/** Absolute path of the shared document, resolved per call so tests can redirect it. */
function documentPath(): string {
  const agentDirectory = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
  return join(agentDirectory, DOCUMENT_NAME)
}

/** Reports every published setting with its stored values and active overrides. */
export async function readExtensionSettings(): Promise<ExtensionSettingsSnapshot> {
  const document = await readDocument()
  return snapshot(document)
}

/**
 * Stores or clears one published setting and reports the resulting snapshot.
 * `null`, `undefined`, and an empty string clear the stored value so the
 * extension default applies again.
 */
export async function updateExtensionSetting(
  extension: string,
  id: string,
  value: unknown,
): Promise<ExtensionSettingsSnapshot> {
  if (!extension || !id) throw new ExtensionSettingsError('Extension and setting are required')
  const document = await readDocument()
  const definition = findDefinition(document, extension, id)
  const cleared = value === null || value === undefined
    || (typeof value === 'string' && value.trim() === '')
  const values = document.values[extension] ?? {}
  if (cleared) delete values[id]
  else values[id] = normalize(definition, value)
  // Drop the namespace once nothing is stored so the shared document stays free of empty remnants.
  if (Object.keys(values).length === 0) delete document.values[extension]
  else document.values[extension] = values
  await writeDocument(document)
  return snapshot(document)
}

function snapshot(document: SettingsDocument): ExtensionSettingsSnapshot {
  const overrides: ExtensionSettingOverride[] = []
  const groups = Object
    .entries(document.definitions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => {
      for (const definition of entry.settings) {
        const env = definition.env
        if (env && process.env[env]?.trim())
          overrides.push({
            extension: name,
            id: definition.id,
            env,
          })
      }
      return { name, description: entry.description, settings: entry.settings }
    })
  return { path: documentPath(), groups, values: document.values, overrides }
}

function findDefinition(
  document: SettingsDocument,
  extension: string,
  id: string,
): ExtensionSettingDefinition {
  const settings = document.definitions[extension]?.settings ?? []
  if (settings.length === 0) {
    throw new ExtensionSettingsError(
      `Extension “${extension}” has not published settings yet. Open a Pi session so it can publish them.`,
    )
  }
  const definition = settings.find((candidate) => candidate.id === id)
  if (!definition)
    throw new ExtensionSettingsError(`Unknown setting “${id}” for extension “${extension}”`)
  return definition
}

/** Coerces and validates one submitted value against its published definition. */
function normalize(definition: ExtensionSettingDefinition, value: unknown): ExtensionSettingValue {
  if (definition.type === 'number') {
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isFinite(parsed))
      throw new ExtensionSettingsError(`“${definition.label}” must be a number`)
    if (definition.minimum !== undefined && parsed < definition.minimum)
      throw new ExtensionSettingsError(
        `“${definition.label}” must be at least ${definition.minimum}`,
      )
    return parsed
  }
  if (definition.type === 'boolean') {
    if (typeof value === 'boolean') return value
    const text = String(value).trim().toLowerCase()
    if (['1', 'true', 'on', 'yes'].includes(text)) return true
    if (['0', 'false', 'off', 'no'].includes(text)) return false
    throw new ExtensionSettingsError(`“${definition.label}” must be true or false`)
  }
  if (typeof value !== 'string')
    throw new ExtensionSettingsError(`“${definition.label}” must be text`)
  if (definition.type === 'enum') {
    const options = definition.options ?? []
    if (!options.includes(value))
      throw new ExtensionSettingsError(
        `“${definition.label}” must be one of: ${options.join(', ')}`,
      )
  }
  return value
}

/**
 * Reads the document. A missing file yields an empty document; invalid JSON
 * fails loudly so a broken hand edit surfaces instead of silently resetting
 * configured values. Unexpected entries are dropped rather than rejected.
 */
async function readDocument(): Promise<SettingsDocument> {
  const path = documentPath()
  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { definitions: {}, values: {} }
    throw new ExtensionSettingsError(`Could not read ${path}: ${describe(error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch (error) {
    throw new ExtensionSettingsError(
      `Extension settings at ${path} are not valid JSON: ${describe(error)}`,
    )
  }
  if (!isObject(parsed))
    throw new ExtensionSettingsError(`Extension settings at ${path} must be a JSON object`)

  const document: SettingsDocument = { definitions: {}, values: {} }
  if (isObject(parsed.definitions)) {
    for (const [name, entry] of Object.entries(parsed.definitions)) {
      if (!isObject(entry) || !Array.isArray(entry.settings)) continue
      const settings = entry.settings.filter(isDefinition)
      if (settings.length === 0) continue
      document.definitions[name] = {
        description: typeof entry.description === 'string' ? entry.description : undefined,
        settings,
      }
    }
  }
  if (isObject(parsed.values)) {
    for (const [name, entry] of Object.entries(parsed.values)) {
      if (!isObject(entry)) continue
      const values: Record<string, ExtensionSettingValue> = {}
      for (const [id, value] of Object.entries(entry)) {
        if (
          typeof value === 'string' || typeof value === 'boolean'
          || (typeof value === 'number' && Number.isFinite(value))
        ) values[id] = value
      }
      document.values[name] = values
    }
  }
  return document
}

/** Replaces the document atomically so a concurrent reader never sees a partial write. */
async function writeDocument(document: SettingsDocument): Promise<void> {
  const path = documentPath()
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function isDefinition(value: unknown): value is ExtensionSettingDefinition {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.label !== 'string')
    return false
  const type = value.type
  if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'enum') return false
  if (value.options !== undefined && !Array.isArray(value.options)) return false
  return true
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
