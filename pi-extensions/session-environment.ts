import type {
  BuildSystemPromptOptions,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { isObject } from '../shared/is-object.ts'
import type {
  SessionEnvironmentContextFile,
  SessionEnvironmentReport,
  SessionEnvironmentSkill,
  SessionEnvironmentTool,
  SessionEnvironmentToolParam,
} from '../shared/types.ts'

const statusKey = 'pi-livecraft.environment'
const maxParams = 40

/**
 * Publishes what the session has loaded — tools and context files — to Pi Livecraft.
 * Skills, prompt templates, and extension commands already reach the browser through the
 * RPC `get_commands` snapshot, so only the data without an RPC equivalent is published.
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
