import { isObject } from './is-object.ts'
import type {
  ResponseControlsReport,
  ResponseControlsState,
  ResponseSummary,
  ResponseVerbosity,
} from './types.ts'

/**
 * Identity shared by the response-controls Pi extension: the session entry type it
 * appends and the private `/livecraft-response-controls` command it registers.
 */
export const responseControlsProtocol = 'pi-livecraft.response-controls'

const verbosityValues: readonly ResponseVerbosity[] = ['low', 'medium', 'high']
const summaryValues: readonly ResponseSummary[] = ['auto', 'concise', 'detailed', 'none']

/** Model ids that accept Responses-API verbosity and reasoning-summary request fields. */
const responseControlsModelIds = new Set([
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
])

/** Providers that pass Responses payload fields through to OpenAI-compatible backends. */
const responseControlsProviders = new Set(['openai', 'openai-codex', 'azure-openai-responses'])

const responseControlsApis = new Set([
  'openai-responses',
  'openai-codex-responses',
  'azure-openai-responses',
])

/**
 * True when the model accepts `text.verbosity` and `reasoning.summary` request fields.
 * Gating on provider and API keeps proxies or gateways that merely reuse a GPT model
 * id from receiving Responses-only fields they may reject.
 */
export function supportsResponseControls(model: unknown): boolean {
  if (!isObject(model)) return false
  return typeof model.id === 'string' && responseControlsModelIds.has(model.id)
    && typeof model.provider === 'string' && responseControlsProviders.has(model.provider)
    && typeof model.api === 'string' && responseControlsApis.has(model.api)
}

/** Keeps only valid verbosity and summary values from untrusted entry data. */
export function parseResponseControlsState(value: unknown): ResponseControlsState {
  const source = isObject(value) ? value : {}
  const verbosity = verbosityValues.find((candidate) => candidate === source.verbosity)
  const summary = summaryValues.find((candidate) => candidate === source.summary)
  return { ...(verbosity ? { verbosity } : {}), ...(summary ? { summary } : {}) }
}

/**
 * Reads the newest response-controls entry on the active branch. Entries from
 * abandoned branches are ignored, matching how the visible conversation is rebuilt.
 */
export function latestResponseControlsState(
  entries: readonly unknown[],
  leafId: unknown,
): ResponseControlsState {
  if (typeof leafId !== 'string') return {}
  const entriesById = new Map<string, unknown>()
  for (const entry of entries) {
    if (isObject(entry) && typeof entry.id === 'string') entriesById.set(entry.id, entry)
  }
  const visited = new Set<string>()
  let id: string | null = leafId
  while (id && !visited.has(id)) {
    visited.add(id)
    const entry = entriesById.get(id)
    if (!isObject(entry)) break
    if (entry.type === 'custom' && entry.customType === responseControlsProtocol)
      return parseResponseControlsState(entry.data)
    id = typeof entry.parentId === 'string' ? entry.parentId : null
  }
  return {}
}

/**
 * Builds the composer-facing report from data the session snapshot already holds:
 * the capability check needs the current model and the extension's registration,
 * the overrides come from the newest state entry on the active branch.
 */
export function responseControlsReport(
  entries: readonly unknown[],
  leafId: unknown,
  model: unknown,
  extensionRegistered: boolean,
): ResponseControlsReport {
  if (!extensionRegistered || !supportsResponseControls(model)) return { supported: false }
  return { supported: true, ...latestResponseControlsState(entries, leafId) }
}

export interface ResponseControlsCommand {
  verbosity?: ResponseVerbosity | 'default'
  summary?: ResponseSummary | 'default'
  /** Raw input that matched no known setting; callers report it instead of acting. */
  invalid?: string
}

/** Parses `/livecraft-response-controls` arguments; `default` clears an override. */
export function parseResponseControlsArgs(args: string): ResponseControlsCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  const [key, value] = parts
  if (value === undefined) return { invalid: key }
  if (key === 'verbosity') {
    return value === 'default' || verbosityValues.some((candidate) => candidate === value)
      ? { verbosity: value as ResponseVerbosity | 'default' }
      : { invalid: args.trim() }
  }
  if (key === 'summary') {
    return value === 'default' || summaryValues.some((candidate) => candidate === value)
      ? { summary: value as ResponseSummary | 'default' }
      : { invalid: args.trim() }
  }
  return { invalid: key }
}
