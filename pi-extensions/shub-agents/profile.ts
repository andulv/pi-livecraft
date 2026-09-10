/**
 * Shub-agent profiles: Markdown files with YAML frontmatter that declare one
 * agent's tools, defaults, and system prompt.
 *
 * This module owns parsing, strict validation, trust-aware discovery, and the
 * parent-visible catalog text. Profiles are data: they may not reference
 * extension paths, arguments, environment, or executables — the host owns that
 * policy. Callers never consume raw frontmatter.
 */
import { readFile, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { parse } from 'yaml'

export const EFFORT_LEVELS = ['quick', 'standard', 'deep'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** Shared caller contract: budgets are host policy, not per-profile tuning. */
export const EFFORT_PRESETS: Record<
  EffortLevel,
  { timeoutMs: number; softToolCalls: number; hardToolCalls: number; guidance: string }
> = {
  quick: {
    timeoutMs: 90_000,
    softToolCalls: 6,
    hardToolCalls: 8,
    guidance:
      'Answer one narrow question: a known file or symbol, one page, one image, or one search.',
  },
  standard: {
    timeoutMs: 240_000,
    softToolCalls: 12,
    hardToolCalls: 16,
    guidance:
      'Map one feature across files, or run one focused web investigation with cited sources.',
  },
  deep: {
    timeoutMs: 600_000,
    softToolCalls: 24,
    hardToolCalls: 32,
    guidance:
      'Cross-reference several angles or sources, resolve contradictions, and synthesize at length.',
  },
}

const MAX_DESCRIPTION_CHARS = 200
const MAX_PROFILE_BODY_CHARS = 12_000
const MAX_CATALOG_AGENTS = 12
/** The assembled tool description must stay within this budget. */
export const MAX_TOOL_DESCRIPTION_CHARS = 2_700

/** One validated agent definition. `sourcePath` exists for diagnostics only. */
export interface ShubProfile {
  name: string
  description: string
  tools: string[]
  model?: string
  thinking?: ThinkingLevel
  defaultEffort: EffortLevel
  projectContext: boolean
  body: string
  sourcePath: string
}

export interface ProfileDiagnostic {
  path: string
  reason: string
}

export interface ProfileDirectory {
  label: 'bundled' | 'user' | 'project'
  path: string
}

/** Default profile directories outside the workspace: bundled first, then user. */
export function defaultProfileDirectories(extensionDirectory: string): ProfileDirectory[] {
  const agentDirectory = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
  return [
    { label: 'bundled', path: join(extensionDirectory, 'agents') },
    { label: 'user', path: join(agentDirectory, 'shub-agents') },
  ]
}

/** Resolves `<workspace>/.pi/shub-agents` for trusted projects. */
export function projectProfileDirectory(workspacePath: string): string {
  return resolve(workspacePath, '.pi', 'shub-agents')
}

/** Parses and validates one profile file. One file yields a profile or one diagnostic. */
export function parseProfile(
  raw: string,
  sourcePath: string,
  knownTools: ReadonlySet<string>,
): { profile?: ShubProfile; diagnostic?: ProfileDiagnostic } {
  const fail = (reason: string): { diagnostic: ProfileDiagnostic } => ({
    diagnostic: { path: sourcePath, reason },
  })

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
  if (!frontmatter) return fail('profile must start with --- frontmatter')

  let fields: unknown
  try {
    fields = parse(frontmatter[1])
  } catch (error) {
    return fail(`frontmatter is not valid YAML: ${causeMessage(error)}`)
  }
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    return fail('frontmatter must be a mapping of fields')
  }
  const field = fields as Record<string, unknown>

  const known = new Set([
    'name',
    'description',
    'tools',
    'model',
    'thinking',
    'defaultEffort',
    'projectContext',
  ])
  const unknownFields = Object.keys(field).filter((key) => !known.has(key))
  if (unknownFields.length > 0) return fail(`unknown field(s): ${unknownFields.join(', ')}`)

  const name = field.name
  if (typeof name !== 'string' || !/^[a-z0-9-]{1,32}$/.test(name)) {
    return fail('name must be 1-32 characters of a-z, 0-9, and hyphens')
  }
  const description = typeof field.description === 'string' ? field.description.trim() : ''
  if (!description) return fail('description is required')
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return fail(`description must be at most ${MAX_DESCRIPTION_CHARS} characters`)
  }

  const rawTools = field.tools
  if (!Array.isArray(rawTools) || rawTools.length === 0) {
    return fail('tools must be a non-empty list of tool names')
  }
  const tools: string[] = []
  for (const tool of rawTools) {
    if (typeof tool !== 'string' || !tool.trim()) return fail('tools must be tool name strings')
    const toolName = tool.trim()
    if (!knownTools.has(toolName)) {
      return fail(`unknown tool '${toolName}'. Known tools: ${[...knownTools].sort().join(', ')}`)
    }
    if (!tools.includes(toolName)) tools.push(toolName)
  }

  const model = typeof field.model === 'string' && field.model.trim()
    ? field.model.trim()
    : undefined
  if (field.model !== undefined && !model) return fail('model must be a non-empty string')

  let thinking: ThinkingLevel | undefined
  if (field.thinking !== undefined) {
    if (
      typeof field.thinking !== 'string'
      || !THINKING_LEVELS.includes(field.thinking as ThinkingLevel)
    ) {
      return fail(`thinking must be one of: ${THINKING_LEVELS.join(', ')}`)
    }
    thinking = field.thinking as ThinkingLevel
  }

  let defaultEffort: EffortLevel = 'standard'
  if (field.defaultEffort !== undefined) {
    if (
      typeof field.defaultEffort !== 'string'
      || !EFFORT_LEVELS.includes(field.defaultEffort as EffortLevel)
    ) {
      return fail(`defaultEffort must be one of: ${EFFORT_LEVELS.join(', ')}`)
    }
    defaultEffort = field.defaultEffort as EffortLevel
  }

  if (field.projectContext !== undefined && typeof field.projectContext !== 'boolean') {
    return fail('projectContext must be a boolean')
  }

  const body = raw.slice(frontmatter[0].length).trim()
  if (!body) return fail('profile body (the system prompt) is required')
  if (body.length > MAX_PROFILE_BODY_CHARS) {
    return fail(`profile body must be at most ${MAX_PROFILE_BODY_CHARS} characters`)
  }

  return {
    profile: {
      name,
      description,
      tools,
      model,
      thinking,
      defaultEffort,
      projectContext: field.projectContext === true,
      body,
      sourcePath,
    },
  }
}

export interface DiscoveredProfiles {
  profiles: ShubProfile[]
  diagnostics: ProfileDiagnostic[]
}

/**
 * Reads every profile directory and returns the valid, deduplicated profiles
 * sorted by name. One invalid or colliding file never prevents the others.
 */
export async function discoverProfiles(
  directories: readonly ProfileDirectory[],
  knownTools: ReadonlySet<string>,
): Promise<DiscoveredProfiles> {
  const diagnostics: ProfileDiagnostic[] = []
  const candidates: ShubProfile[] = []

  for (const directory of directories) {
    let entries
    try {
      entries = await readdir(directory.path, { withFileTypes: true })
    } catch {
      continue // A missing or unreadable scope contributes nothing; bundled files always exist.
    }
    for (const entry of entries) {
      if (!entry.name.endsWith('.md') || (!entry.isFile() && !entry.isSymbolicLink())) continue
      const path = join(directory.path, entry.name)
      if (entry.isSymbolicLink() && !(await symlinkStaysInside(path, directory.path))) {
        diagnostics.push({ path, reason: 'symlink target must stay inside the profile directory' })
        continue
      }
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch (error) {
        diagnostics.push({ path, reason: `unreadable: ${causeMessage(error)}` })
        continue
      }
      const parsed = parseProfile(raw, path, knownTools)
      if (parsed.profile) candidates.push(parsed.profile)
      if (parsed.diagnostic) diagnostics.push(parsed.diagnostic)
    }
  }

  // A name collision excludes every colliding definition so the selected agent is deterministic.
  const byName = new Map<string, ShubProfile[]>()
  for (const profile of candidates) {
    const group = byName.get(profile.name) ?? []
    group.push(profile)
    byName.set(profile.name, group)
  }
  const profiles: ShubProfile[] = []
  for (const group of byName.values()) {
    if (group.length === 1) {
      profiles.push(group[0])
      continue
    }
    diagnostics.push({
      path: group.map((profile) => profile.sourcePath).join(', '),
      reason: `profile name '${
        group[0].name
      }' is defined more than once; all definitions are excluded`,
    })
  }
  profiles.sort((left, right) => left.name.localeCompare(right.name))
  return { profiles, diagnostics }
}

async function symlinkStaysInside(path: string, directory: string): Promise<boolean> {
  try {
    const target = await realpath(path)
    const base = await realpath(directory)
    return target === base || target.startsWith(base + sep)
  } catch {
    return false
  }
}

/**
 * Deterministically selects the advertised catalog: the first agents by name,
 * capped at 12 agents and at the assembled tool-description budget. Omitted
 * names are returned so the host can report them without exposing them to the
 * model.
 */
export function catalogSelection(profiles: readonly ShubProfile[]): {
  included: ShubProfile[]
  omitted: string[]
} {
  const included: ShubProfile[] = []
  const omitted: string[] = []
  for (const profile of [...profiles].sort((left, right) => left.name.localeCompare(right.name))) {
    if (
      included.length >= MAX_CATALOG_AGENTS
      || toolDescription([...included, profile]).length > MAX_TOOL_DESCRIPTION_CHARS
    ) {
      omitted.push(profile.name)
      continue
    }
    included.push(profile)
  }
  return { included, omitted }
}

/** The complete shub_agent description: dispatch sentence, agent catalog, effort hint. */
export function toolDescription(agents: readonly ShubProfile[]): string {
  const catalog = agents.length > 0
    ? agents.map((agent) => `${agent.name} — ${agent.description}`).join('\n')
    : 'No agent profiles are available.'
  return [
    'Delegate a bounded task to one available specialist agent. The call blocks until the child finishes and persists its own inspectable session.',
    '',
    'Agents:',
    catalog,
    '',
    'Effort quick, standard, or deep sets the timeout and tool-call budget; pick the smallest that can answer.',
  ]
    .join('\n')
}

function causeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
