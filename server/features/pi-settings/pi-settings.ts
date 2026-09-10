/**
 * Reads and writes Pi's own settings files: `~/.pi/agent/settings.json` (global)
 * and `<workspace>/.pi/settings.json` (project). These are the same files the
 * `pi` command line reads, so a value saved here also applies to plain `pi`.
 *
 * A curated field registry renders the settings users commonly change as typed
 * controls; every other key stays editable through the raw-JSON editor and is
 * preserved untouched on every write. Persistence copies the proven
 * extension-settings mechanics: per-call path resolution, a missing file yields
 * an empty document, invalid JSON fails loudly, and writes replace the file
 * atomically through a temporary file.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isObject } from '../../../shared/is-object.ts'
import type {
  PiSettingField,
  PiSettingsScope,
  PiSettingsScopeDocument,
  PiSettingsSnapshot,
  PiSettingValue,
} from '../../../shared/pi-settings.ts'

/** Reported for an invalid update or a settings document that cannot be used. */
export class PiSettingsError extends Error {}

const DOCUMENT_NAME = 'settings.json'

/**
 * Curated settings rendered as typed controls. Keys absent here remain editable
 * through the raw-JSON editor; adding one here never drops the others.
 */
const FIELDS: PiSettingField[] = [
  {
    id: 'defaultProvider',
    label: 'Startup provider',
    description: 'Provider used when a session starts.',
    group: 'Model & thinking',
    type: 'string',
  },
  {
    id: 'defaultModel',
    label: 'Startup model',
    description: 'Model ID used when a session starts.',
    group: 'Model & thinking',
    type: 'string',
  },
  {
    id: 'defaultThinkingLevel',
    label: 'Default thinking level',
    description: 'Startup thinking level.',
    group: 'Model & thinking',
    type: 'enum',
    options: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'hideThinkingBlock',
    label: 'Hide thinking block',
    description: 'Hide thinking blocks in output.',
    group: 'Model & thinking',
    type: 'boolean',
    defaultValue: false,
  },
  {
    id: 'enabledModels',
    label: 'Model cycling patterns',
    description: 'Patterns for Ctrl+P model cycling, comma-separated.',
    group: 'Model & thinking',
    type: 'string-array',
  },
  {
    id: 'steeringMode',
    label: 'Steering message delivery',
    description: 'How steering messages are sent.',
    group: 'Behavior',
    type: 'enum',
    options: ['all', 'one-at-a-time'],
    defaultValue: 'one-at-a-time',
  },
  {
    id: 'followUpMode',
    label: 'Follow-up message delivery',
    description: 'How follow-up messages are sent.',
    group: 'Behavior',
    type: 'enum',
    options: ['all', 'one-at-a-time'],
    defaultValue: 'one-at-a-time',
  },
  {
    id: 'compaction.enabled',
    label: 'Auto-compaction',
    description: 'Enable automatic history compaction.',
    group: 'Behavior',
    type: 'boolean',
    defaultValue: true,
  },
  {
    id: 'compaction.reserveTokens',
    label: 'Compaction reserve tokens',
    description: 'Tokens reserved for the LLM response.',
    group: 'Behavior',
    type: 'number',
    minimum: 0,
    defaultValue: 16384,
  },
  {
    id: 'compaction.keepRecentTokens',
    label: 'Compaction keep-recent tokens',
    description: 'Recent tokens kept unsummarized.',
    group: 'Behavior',
    type: 'number',
    minimum: 0,
    defaultValue: 20000,
  },
  {
    id: 'retry.enabled',
    label: 'Automatic retry',
    description: 'Retry the agent on transient errors.',
    group: 'Behavior',
    type: 'boolean',
    defaultValue: true,
  },
  {
    id: 'retry.maxRetries',
    label: 'Maximum retries',
    description: 'Maximum agent-level retry attempts.',
    group: 'Behavior',
    type: 'number',
    minimum: 0,
    defaultValue: 3,
  },
  {
    id: 'theme',
    label: 'Theme',
    description: 'Pi terminal theme name.',
    group: 'UI & environment',
    type: 'string',
    defaultValue: 'dark',
  },
  {
    id: 'externalEditor',
    label: 'External editor',
    description: 'Command for the Ctrl+G external editor.',
    group: 'UI & environment',
    type: 'string',
  },
  {
    id: 'markdown.mermaid',
    label: 'Mermaid rendering',
    description: 'Mermaid diagram rendering mode.',
    group: 'UI & environment',
    type: 'enum',
    options: ['off', 'final', 'streaming'],
    defaultValue: 'streaming',
  },
  {
    id: 'sessionDir',
    label: 'Session directory',
    description: 'Directory where session files are stored.',
    group: 'UI & environment',
    type: 'string',
  },
  {
    id: 'defaultProjectTrust',
    label: 'Default project trust',
    description: 'Fallback trust behavior for untrusted projects.',
    group: 'UI & environment',
    type: 'enum',
    options: ['ask', 'always', 'never'],
    defaultValue: 'ask',
    globalOnly: true,
  },
  {
    id: 'httpProxy',
    label: 'HTTP proxy',
    description: 'Proxy URL applied as HTTP_PROXY and HTTPS_PROXY.',
    group: 'UI & environment',
    type: 'string',
    globalOnly: true,
  },
]

/** Absolute path of the global settings file, resolved per call so tests can redirect it. */
function globalPath(): string {
  const agentDirectory = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
  return join(agentDirectory, DOCUMENT_NAME)
}

/** Absolute path of a project settings file for the given workspace directory. */
function projectPath(cwd: string): string {
  return join(cwd, '.pi', DOCUMENT_NAME)
}

/** Reports both settings files, their parsed contents, and the field registry. */
export async function readPiSettings(cwd?: string): Promise<PiSettingsSnapshot> {
  const scopes: PiSettingsScopeDocument[] = [await readScope('global', globalPath())]
  const projectAvailable = Boolean(cwd)
  if (cwd) scopes.push(await readScope('project', projectPath(cwd)))
  else scopes.push({ scope: 'project', path: '', exists: false, values: {}, raw: '{}\n' })
  return { fields: FIELDS, scopes, projectAvailable }
}

/**
 * Stores or clears one curated field in the target scope and reports the
 * refreshed snapshot. `null`, `undefined`, an empty string, or an empty array
 * clears the key so the lower-precedence value applies again.
 */
export async function updatePiSetting(
  scope: PiSettingsScope,
  cwd: string | undefined,
  id: string,
  value: unknown,
): Promise<PiSettingsSnapshot> {
  const field = FIELDS.find((candidate) => candidate.id === id)
  if (!field) throw new PiSettingsError(`Unknown setting “${id}”`)
  if (field.globalOnly && scope === 'project')
    throw new PiSettingsError(`“${field.label}” can only be set in global settings`)
  const path = pathForScope(scope, cwd)
  const document = await readDocument(path)
  const cleared = value === null || value === undefined
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0)
  if (cleared) clearPath(document, id)
  else setPath(document, id, normalize(field, value))
  await writeDocument(path, document)
  return readPiSettings(cwd)
}

/** Parses and writes a whole settings document verbatim, preserving every key. */
export async function savePiSettingsDocument(
  scope: PiSettingsScope,
  cwd: string | undefined,
  text: string,
): Promise<PiSettingsSnapshot> {
  const trimmed = text.trim()
  let parsed: unknown = {}
  if (trimmed !== '') {
    try {
      parsed = JSON.parse(trimmed)
    } catch (error) {
      throw new PiSettingsError(`Invalid JSON: ${describe(error)}`)
    }
  }
  if (!isObject(parsed)) throw new PiSettingsError('Settings must be a JSON object')
  await writeDocument(pathForScope(scope, cwd), parsed)
  return readPiSettings(cwd)
}

function pathForScope(scope: PiSettingsScope, cwd: string | undefined): string {
  if (scope === 'global') return globalPath()
  if (!cwd) throw new PiSettingsError('No workspace is selected for project settings')
  return projectPath(cwd)
}

async function readScope(
  scope: PiSettingsScope,
  path: string,
): Promise<PiSettingsScopeDocument> {
  let contents: string | null
  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { scope, path, exists: false, values: {}, raw: '{}\n' }
    }
    throw new PiSettingsError(`Could not read ${path}: ${describe(error)}`)
  }
  const values = parseDocument(path, contents)
  return { scope, path, exists: true, values, raw: `${JSON.stringify(values, null, 2)}\n` }
}

/** Reads a document for mutation. A missing file yields an empty object. */
async function readDocument(path: string): Promise<Record<string, unknown>> {
  try {
    return parseDocument(path, await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    if (error instanceof PiSettingsError) throw error
    throw new PiSettingsError(`Could not read ${path}: ${describe(error)}`)
  }
}

/** Parses JSON; invalid JSON fails loudly so a broken hand edit surfaces. */
function parseDocument(path: string, contents: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch (error) {
    throw new PiSettingsError(`Settings at ${path} are not valid JSON: ${describe(error)}`)
  }
  if (!isObject(parsed)) throw new PiSettingsError(`Settings at ${path} must be a JSON object`)
  return parsed
}

/** Replaces the document atomically so a concurrent reader never sees a partial write. */
async function writeDocument(path: string, document: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

/** Sets a dotted key path, creating intermediate objects as needed. */
function setPath(document: Record<string, unknown>, id: string, value: PiSettingValue): void {
  const segments = id.split('.')
  let current = document
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    const next = current[segment]
    if (!isObject(next)) current[segment] = {}
    current = current[segment] as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
}

/** Removes a dotted key path and prunes parent objects it leaves empty. */
function clearPath(document: Record<string, unknown>, id: string): void {
  const segments = id.split('.')
  const parents: Record<string, unknown>[] = [document]
  let current = document
  for (let index = 0; index < segments.length - 1; index += 1) {
    const next = current[segments[index]]
    if (!isObject(next)) return
    current = next
    parents.push(current)
  }
  delete current[segments[segments.length - 1]]
  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const parent = parents[index]
    const key = segments[index]
    if (isObject(parent[key]) && Object.keys(parent[key] as object).length === 0) delete parent[key]
    else break
  }
}

/** Coerces and validates one submitted value against its field definition. */
function normalize(field: PiSettingField, value: unknown): PiSettingValue {
  if (field.type === 'number') {
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isFinite(parsed)) throw new PiSettingsError(`“${field.label}” must be a number`)
    if (field.minimum !== undefined && parsed < field.minimum)
      throw new PiSettingsError(`“${field.label}” must be at least ${field.minimum}`)
    return parsed
  }
  if (field.type === 'boolean') {
    if (typeof value === 'boolean') return value
    const text = String(value).trim().toLowerCase()
    if (['1', 'true', 'on', 'yes'].includes(text)) return true
    if (['0', 'false', 'off', 'no'].includes(text)) return false
    throw new PiSettingsError(`“${field.label}” must be true or false`)
  }
  if (field.type === 'string-array') {
    const items = Array.isArray(value)
      ? value.map((item) => String(item).trim())
      : String(value).split(',').map((item) => item.trim())
    return items.filter((item) => item !== '')
  }
  if (typeof value !== 'string') throw new PiSettingsError(`“${field.label}” must be text`)
  if (field.type === 'enum' && !(field.options ?? []).includes(value))
    throw new PiSettingsError(
      `“${field.label}” must be one of: ${(field.options ?? []).join(', ')}`,
    )
  return value
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
