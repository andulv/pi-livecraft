import type {
  BuildSystemPromptOptions,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { isObject } from '../shared/is-object.ts'
import type {
  SessionEnvironmentContextFile,
  SessionEnvironmentPromptPart,
  SessionEnvironmentPromptSource,
  SessionEnvironmentReport,
  SessionEnvironmentSkill,
  SessionEnvironmentSystemPrompt,
  SessionEnvironmentTool,
  SessionEnvironmentToolParam,
} from '../shared/types.ts'

const statusKey = 'pi-livecraft.environment'
const maxParams = 40

/**
 * Publishes what the session has loaded — tools, context files, and the assembled
 * system prompt with its inspectable components — to Pi Livecraft. Skills, prompt
 * templates, and extension commands already reach the browser through the RPC
 * `get_commands` snapshot, so only the data without an RPC equivalent is published.
 */
export default function registerSessionEnvironment(pi: ExtensionAPI): void {
  pi.on('session_start', (_event, ctx) => {
    // A command context is needed for system-prompt options; report tools only at start.
    publish(pi, ctx, undefined)
  })
  pi.registerCommand('livecraft-environment', {
    description: 'Refresh the Pi Livecraft session environment',
    handler: async (_args, ctx) => publish(pi, ctx, ctx.getSystemPromptOptions()),
  })
}

function publish(
  pi: ExtensionAPI,
  ctx: ExtensionContext | ExtensionCommandContext,
  options: BuildSystemPromptOptions | undefined,
): void {
  const report: SessionEnvironmentReport = {
    protocol: 'pi-livecraft.environment',
    version: 1,
    refreshedAt: Date.now(),
    tools: buildTools(pi),
  }
  const skills = buildSkills(pi, options)
  if (skills) report.skills = skills
  report.systemPrompt = buildSystemPrompt(pi, ctx, options)
  const contextFiles = buildContextFiles(options)
  if (contextFiles) report.contextFiles = contextFiles
  ctx.ui.setStatus(statusKey, JSON.stringify(report))
}

function buildTools(pi: ExtensionAPI): SessionEnvironmentTool[] {
  const active = new Set(pi.getActiveTools())
  return pi.getAllTools().map((tool) => {
    const source = tool.sourceInfo?.source
    const entry: SessionEnvironmentTool = {
      name: tool.name,
      active: active.has(tool.name),
      source: source === 'builtin' || source === 'sdk' ? source : 'extension',
    }
    if (typeof tool.description === 'string' && tool.description)
      entry.description = clip(tool.description, 200)
    if (entry.source === 'extension' && typeof tool.sourceInfo?.path === 'string') {
      entry.sourceName = fileNameOf(tool.sourceInfo.path)
      entry.sourcePath = tool.sourceInfo.path
    }
    entry.estimatedContextChars = estimateToolContextChars(tool)
    const params = summarizeParams(tool.parameters)
    if (params.length > 0) entry.params = params
    return entry
  })
}

/**
 * Approximates the tool definition's prompt footprint without exposing its schema.
 * Providers and tokenizers serialize tools differently, so callers must label this as an estimate.
 */
function estimateToolContextChars(
  tool: { name: string; description?: string; parameters?: unknown },
): number {
  try {
    return [...JSON.stringify({
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.parameters ?? {},
    })]
      .length
  } catch {
    return 0
  }
}

/** Summarizes the top-level object properties of a tool's parameter schema. */
function summarizeParams(schema: unknown): SessionEnvironmentToolParam[] {
  const root = isObject(schema) ? schema : undefined
  const properties = isObject(root?.properties) ? root.properties : undefined
  if (!properties) return []
  const required = Array.isArray(root?.required)
    ? new Set(root.required.filter((name): name is string => typeof name === 'string'))
    : new Set<string>()
  return Object.entries(properties).slice(0, maxParams).map(([name, value]) => {
    const property = isObject(value) ? value : {}
    const param: SessionEnvironmentToolParam = { name }
    if (typeof property.type === 'string') param.type = property.type
    if (required.has(name)) param.required = true
    if (typeof property.description === 'string' && property.description)
      param.description = clip(property.description, 140)
    return param
  })
}

/**
 * Publishes skill provenance — Pi's canonical sourceInfo — without exposing skill contents.
 * The prompt entry Pi places for an available skill (name plus description) is measured
 * client-side from the RPC command data, so no content crosses this boundary.
 */
function buildSkills(
  pi: ExtensionAPI,
  options: BuildSystemPromptOptions | undefined,
): SessionEnvironmentSkill[] | undefined {
  const active = options?.selectedTools?.includes('read')
  return pi.getCommands().flatMap((command) => {
    if (command.source !== 'skill' || !command.sourceInfo?.path) return []
    const source = command.sourceInfo
    const entry: SessionEnvironmentSkill = { name: command.name, path: source.path }
    if (active !== undefined) entry.active = active
    if (typeof source.scope === 'string') entry.scope = source.scope
    if (typeof source.origin === 'string') entry.origin = source.origin
    if (typeof source.baseDir === 'string' && source.baseDir) entry.baseDir = source.baseDir
    return [entry]
  })
}

/**
 * Measures the assembled system prompt — the string Pi will actually send — together
 * with its structured components, and publishes the inspectable prompt text plus the
 * sections grouped by their owner. The assembled text embeds context-file contents by
 * design: it is the exact text the next provider request carries.
 */
function buildSystemPrompt(
  pi: ExtensionAPI,
  ctx: ExtensionContext | ExtensionCommandContext,
  options: BuildSystemPromptOptions | undefined,
): SessionEnvironmentSystemPrompt {
  const prompt = ctx.getSystemPrompt()
  const entry: SessionEnvironmentSystemPrompt = { totalChars: prompt.length, text: prompt }
  const customPrompt = options?.customPrompt
  if (customPrompt) {
    entry.hasCustomPrompt = true
    entry.customPrompt = customPrompt
  }
  const guidelines = options?.promptGuidelines ?? []
  if (guidelines.length > 0) {
    entry.guidelinesCount = guidelines.length
    entry.guidelinesChars = guidelines.reduce((total, guideline) => total + guideline.length, 0)
    entry.guidelines = [...guidelines]
  }
  if (options?.appendSystemPrompt) {
    entry.appendChars = options.appendSystemPrompt.length
    entry.appendText = options.appendSystemPrompt
  }
  const snippets = options?.toolSnippets ? Object.entries(options.toolSnippets) : []
  if (snippets.length > 0) {
    entry.toolSnippetCount = snippets.length
    entry.toolSnippetChars = snippets.reduce((total, [, snippet]) => total + snippet.length, 0)
    entry.toolSnippets = snippets
      .filter(([name, text]) => typeof name === 'string' && typeof text === 'string')
      .map(([tool, text]) => ({ tool, text }))
  }
  const parts = buildPromptParts(pi, prompt.length, options)
  if (parts) entry.parts = parts
  return entry
}

/** Owner of a prompt contribution, derived from the registering tool's source metadata. */
interface PromptOwner {
  key: string
  source: SessionEnvironmentPromptSource
  path?: string
  name?: string
}

function ownerOfTool(tool: {
  sourceInfo?: { source?: unknown; path?: unknown }
}): PromptOwner {
  const source = tool.sourceInfo?.source
  if (source === 'sdk') return { key: 'sdk', source: 'sdk' }
  if (source === 'builtin') return { key: 'pi', source: 'pi' }
  // Pi reports locally loaded extensions as 'local'; anything that is not builtin/sdk
  // is an extension owner, keyed by its file path.
  if (typeof tool.sourceInfo?.path !== 'string' || !tool.sourceInfo.path) {
    return { key: 'extension:unknown', source: 'extension' }
  }
  const path = tool.sourceInfo.path
  return { key: `extension:${path}`, source: 'extension', path, name: fileNameOf(path) }
}

/**
 * Groups the system prompt's components by the owner that contributed them. Tools
 * carry their own snippet and guideline texts, so ownership comes from the tool
 * registry; guideline bullets Pi received without a matching tool stay under the
 * unattributable 'session' owner. Returns undefined when no command context exposed
 * the system-prompt options (session start).
 */
function buildPromptParts(
  pi: ExtensionAPI,
  totalChars: number,
  options: BuildSystemPromptOptions | undefined,
): SessionEnvironmentPromptPart[] | undefined {
  if (!options) return undefined
  const parts: SessionEnvironmentPromptPart[] = []
  const active = new Set(pi.getActiveTools())
  const ownerBuckets = new Map<string, { owner: PromptOwner; tools: string[]; bullets: string[] }>()
  const toolOwners = new Map<string, PromptOwner>()
  for (const tool of pi.getAllTools()) {
    const owner = ownerOfTool(tool)
    toolOwners.set(tool.name, owner)
    if (!active.has(tool.name) || !Array.isArray(tool.promptGuidelines)) continue
    const bullets = tool.promptGuidelines.filter((bullet): bullet is string =>
      typeof bullet === 'string' && bullet.length > 0
    )
    if (bullets.length === 0) continue
    const bucket = ownerBuckets.get(owner.key) ?? { owner, tools: [], bullets: [] }
    bucket.tools.push(tool.name)
    bucket.bullets.push(...bullets)
    ownerBuckets.set(owner.key, bucket)
  }
  // Claim each published guideline bullet for the first tool that declares it.
  const published = (options.promptGuidelines ?? []).filter((bullet) => typeof bullet === 'string')
  const claimed = new Set<number>()
  for (const bucket of ownerBuckets.values()) {
    const owned: string[] = []
    for (const bullet of bucket.bullets) {
      const index = published.findIndex(
        (candidate, at) => !claimed.has(at) && candidate === bullet,
      )
      if (index < 0) continue
      claimed.add(index)
      owned.push(bullet)
    }
    if (owned.length > 0) {
      parts.push({
        kind: 'guidelines',
        source: bucket.owner.source,
        ...(bucket.owner.path ? { ownerPath: bucket.owner.path } : {}),
        ...(bucket.owner.name ? { ownerName: bucket.owner.name } : {}),
        tools: [...bucket.tools],
        chars: owned.reduce((total, bullet) => total + bullet.length, 0),
        text: owned.map((bullet) => `- ${bullet}`).join('\n'),
      })
    }
  }
  const leftover = published.filter((_, index) => !claimed.has(index))
  if (leftover.length > 0) {
    parts.push({
      kind: 'guidelines',
      source: 'session',
      chars: leftover.reduce((total, bullet) => total + bullet.length, 0),
      text: leftover.map((bullet) => `- ${bullet}`).join('\n'),
    })
  }
  const snippetLines = new Map<string, { owner: PromptOwner; tools: string[]; lines: string[] }>()
  for (const [tool, snippet] of Object.entries(options.toolSnippets ?? {})) {
    if (typeof snippet !== 'string') continue
    const owner = toolOwners.get(tool) ?? { key: 'session', source: 'session' }
    const bucket = snippetLines.get(owner.key) ?? { owner, tools: [], lines: [] }
    bucket.tools.push(tool)
    bucket.lines.push(`${tool}: ${snippet}`)
    snippetLines.set(owner.key, bucket)
  }
  for (const bucket of snippetLines.values()) {
    parts.push({
      kind: 'snippets',
      source: bucket.owner.source,
      ...(bucket.owner.path ? { ownerPath: bucket.owner.path } : {}),
      ...(bucket.owner.name ? { ownerName: bucket.owner.name } : {}),
      tools: [...bucket.tools],
      chars: bucket.lines.reduce((total, line) => total + line.length, 0),
      text: bucket.lines.join('\n'),
    })
  }
  for (const file of options.contextFiles ?? []) {
    if (typeof file?.path !== 'string' || !file.path) continue
    const content = typeof file.content === 'string' ? file.content : ''
    parts.push({
      kind: 'context',
      source: 'project',
      ownerPath: file.path,
      ownerName: fileNameOf(file.path),
      chars: content.length,
      text: content,
    })
  }
  if (options.customPrompt) {
    parts.push({
      kind: 'custom',
      source: 'session',
      chars: options.customPrompt.length,
      text: options.customPrompt,
    })
  }
  if (options.appendSystemPrompt) {
    parts.push({
      kind: 'append',
      source: 'session',
      chars: options.appendSystemPrompt.length,
      text: options.appendSystemPrompt,
    })
  }
  if (!options.customPrompt) {
    const detailed = parts.reduce((total, part) => total + part.chars, 0)
    // Pi's default prompt is not reproducible through the public API; it carries the
    // remainder of the assembled prompt after the attributable parts.
    parts.unshift({ kind: 'base', source: 'pi', chars: Math.max(0, totalChars - detailed) })
  }
  return parts
}

/** Context file contents stay inside Pi; only paths and byte sizes are published. */
function buildContextFiles(
  options: BuildSystemPromptOptions | undefined,
): SessionEnvironmentContextFile[] | undefined {
  if (!options?.contextFiles) return undefined
  return options
    .contextFiles
    .filter((file) => typeof file?.path === 'string' && file.path)
    .map((file) => ({
      path: file.path,
      bytes: Buffer.byteLength(typeof file.content === 'string' ? file.content : '', 'utf8'),
    }))
}

function clip(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

function fileNameOf(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index >= 0 ? path.slice(index + 1) : path
}
