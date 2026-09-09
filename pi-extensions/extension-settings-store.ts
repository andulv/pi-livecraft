/**
 * Extension-side access to the shared Pi extension settings document
 * (`~/.pi/agent/extension-settings.json`).
 *
 * `server/features/extension-settings/extension-settings.ts` owns the host side
 * of the same document: it renders published definitions and stores user
 * values. This module owns the other half, which only an extension can perform:
 * publishing its definitions on session start and resolving one effective value
 * per call. The two never run in the same process, so they share the contract in
 * `shared/extension-settings.ts` rather than an implementation.
 *
 * Resolution order for one setting is: environment override, stored value, then
 * the definition default. Values are resolved per call, so a setting saved in
 * any settings UI applies to the next tool call without reloading Pi.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isObject } from '../shared/is-object.ts'
import type {
  ExtensionSettingDefinition,
  ExtensionSettingGroup,
  ExtensionSettingValue,
} from '../shared/extension-settings.ts'

const DOCUMENT_NAME = 'extension-settings.json'

interface SettingsDocument {
  definitions: Record<string, { description?: string; settings: ExtensionSettingDefinition[] }>
  values: Record<string, Record<string, ExtensionSettingValue>>
}

/** Every setting of one group resolved to its effective value. */
export type ResolvedSettings = Record<string, ExtensionSettingValue | undefined>

function documentPath(): string {
  const agentDirectory = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
  return join(agentDirectory, DOCUMENT_NAME)
}

/**
 * Publishes the group's definitions so any settings UI can render them. Writes
 * only when the definitions changed, which keeps the steady state read-only
 * even though every session start publishes.
 */
export async function publishExtensionSettings(group: ExtensionSettingGroup): Promise<void> {
  const document = await readDocument()
  const published = { description: group.description, settings: group.settings }
  const existing = document.definitions[group.name]
  if (existing && JSON.stringify(existing) === JSON.stringify(published)) return
  document.definitions[group.name] = published
  await writeDocument(document)
}

/** Resolves every setting of a group: environment override, stored value, default. */
export async function resolveExtensionSettings(
  group: ExtensionSettingGroup,
): Promise<ResolvedSettings> {
  const document = await readDocument()
  const stored = document.values[group.name] ?? {}
  const resolved: ResolvedSettings = {}
  for (const definition of group.settings) {
    const override = definition.env === undefined ? undefined : process.env[definition.env]?.trim()
    if (override) {
      resolved[definition.id] = coerce(definition, override)
      continue
    }
    const value = stored[definition.id]
    resolved[definition.id] = value === undefined ? definition.defaultValue : value
  }
  return resolved
}

/** Narrows a resolved setting to a non-empty string. */
export function stringSetting(settings: ResolvedSettings, id: string): string | undefined {
  const value = settings[id]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Narrows a resolved setting to a finite number. */
export function numberSetting(settings: ResolvedSettings, id: string): number | undefined {
  const value = settings[id]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Coerces an environment override to the declared type. An unusable override is
 * ignored rather than thrown, so a stale variable cannot break every call.
 */
function coerce(
  definition: ExtensionSettingDefinition,
  value: string,
): ExtensionSettingValue | undefined {
  if (definition.type === 'number') {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return definition.defaultValue
    if (definition.minimum !== undefined && parsed < definition.minimum) return definition.minimum
    return parsed
  }
  if (definition.type === 'boolean') {
    if (['1', 'true', 'on', 'yes'].includes(value.toLowerCase())) return true
    if (['0', 'false', 'off', 'no'].includes(value.toLowerCase())) return false
    return definition.defaultValue
  }
  if (definition.type === 'enum' && !(definition.options ?? []).includes(value))
    return definition.defaultValue
  return value
}

/** A missing document yields empty state; invalid JSON is reported to the caller. */
async function readDocument(): Promise<SettingsDocument> {
  const path = documentPath()
  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { definitions: {}, values: {} }
    throw error
  }
  const parsed: unknown = JSON.parse(contents)
  if (!isObject(parsed)) throw new Error(`Extension settings at ${path} must be a JSON object`)

  const document: SettingsDocument = { definitions: {}, values: {} }
  if (isObject(parsed.definitions)) {
    for (const [name, entry] of Object.entries(parsed.definitions)) {
      if (!isObject(entry) || !Array.isArray(entry.settings)) continue
      document.definitions[name] = {
        description: typeof entry.description === 'string' ? entry.description : undefined,
        settings: entry.settings as ExtensionSettingDefinition[],
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

/** Replaces the document atomically so the host never observes a partial write. */
async function writeDocument(document: SettingsDocument): Promise<void> {
  const path = documentPath()
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
