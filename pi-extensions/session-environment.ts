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
  if (options?.customPrompt) entry.hasCustomPrompt = true
  const guidelines = options?.promptGuidelines ?? []
  if (guidelines.length > 0) {
    entry.guidelinesCount = guidelines.length
    entry.guidelinesChars = guidelines.reduce((total, guideline) => total + guideline.length, 0)
  }
  if (options?.appendSystemPrompt) entry.appendChars = options.appendSystemPrompt.length
  const snippets = options?.toolSnippets ? Object.values(options.toolSnippets) : []
  if (snippets.length > 0) {
    entry.toolSnippetCount = snippets.length
    entry.toolSnippetChars = snippets.reduce((total, snippet) => total + snippet.length, 0)
  }
  const parts = buildPromptParts(pi, prompt, options)
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

/** One located contribution: a verbatim span inside the assembled prompt text. */
interface PromptSpan {
  start: number
  end: number
  kind: SessionEnvironmentPromptPart['kind']
  owner: PromptOwner
  tools?: string[]
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

/** Records the first non-overlapping occurrence of `text` in the assembled prompt. */
function claimSpan(
  prompt: string,
  text: string,
  kind: SessionEnvironmentPromptPart['kind'],
  owner: PromptOwner,
  tools: string[] | undefined,
  spans: PromptSpan[],
): void {
  if (!text) return
  let at = prompt.indexOf(text)
  while (at >= 0) {
    const end = at + text.length
    if (!spans.some((span) => at < span.end && span.start < end)) {
      spans.push({ start: at, end, kind, owner, ...(tools ? { tools } : {}) })
      return
    }
    at = prompt.indexOf(text, at + 1)
  }
}

/**
 * Locates the system prompt's attributable sections inside the assembled text.
 * Tools carry their own snippet and guideline texts, so ownership comes from the
 * tool registry; guideline bullets Pi received without a matching tool stay under
 * the unattributable 'session' owner. Unmatched spans are simply absent, and every
 * remaining region belongs to Pi's own prompt skeleton. Returns undefined when no
 * command context exposed the system-prompt options (session start).
 */
function buildPromptParts(
  pi: ExtensionAPI,
  prompt: string,
  options: BuildSystemPromptOptions | undefined,
): SessionEnvironmentPromptPart[] | undefined {
  if (!options) return undefined
  // A custom prompt replaces everything Pi would otherwise assemble.
  if (options.customPrompt) {
    return [{
      kind: 'custom',
      source: 'session',
      chars: prompt.length,
      start: 0,
      end: prompt.length,
    }]
  }
  const spans: PromptSpan[] = []
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
    for (const bullet of bucket.bullets) {
      const index = published.findIndex(
        (candidate, at) => !claimed.has(at) && candidate === bullet,
      )
      if (index < 0) continue
      claimed.add(index)
      claimSpan(prompt, bullet, 'guidelines', bucket.owner, [...bucket.tools], spans)
    }
  }
  // Guideline bullets Pi received that no active tool declares.
  for (const index of claimed.keys()) published[index] = ''
  const leftover = published.filter((bullet) => bullet !== '')
  for (const bullet of leftover) {
    claimSpan(prompt, bullet, 'guidelines', { key: 'session', source: 'session' }, undefined, spans)
  }
  for (const [tool, snippet] of Object.entries(options.toolSnippets ?? {})) {
    if (typeof snippet !== 'string' || !snippet) continue
    const owner = toolOwners.get(tool) ?? { key: 'session', source: 'session' }
    claimSpan(prompt, `${tool}: ${snippet}`, 'snippets', owner, [tool], spans)
  }
  for (const file of options.contextFiles ?? []) {
    if (typeof file?.path !== 'string' || !file.path) continue
    if (typeof file.content !== 'string' || !file.content) continue
    claimSpan(
      prompt,
      file.content,
      'context',
      {
        key: `project:${file.path}`,
        source: 'project',
        path: file.path,
        name: fileNameOf(file.path),
      },
      undefined,
      spans,
    )
  }
  if (options.appendSystemPrompt) {
    claimSpan(
      prompt,
      options.appendSystemPrompt,
      'append',
      { key: 'session', source: 'session' },
      undefined,
      spans,
    )
  }
  spans.sort((left, right) => left.start - right.start || left.end - right.end)
  const parts: SessionEnvironmentPromptPart[] = []
  let cursor = 0
  // Gaps this small are bullet prefixes and newlines of the surrounding sections,
  // not Pi's own content — they are absorbed into the adjacent owned section.
  const isSkeleton = (gap: string): boolean => gap.length <= 60 && !/^#/m.test(gap)
  const emit = (part: SessionEnvironmentPromptPart): void => {
    const last = parts[parts.length - 1]
    if (
      last && last.kind === part.kind && last.source === part.source
      && last.ownerPath === part.ownerPath && last.start !== undefined
      && part.start !== undefined && part.start - (last.end ?? 0) <= 0
    ) {
      last.end = part.end
      return
    }
    parts.push(part)
  }
  for (const span of spans) {
    if (span.start < cursor) continue
    if (span.start > cursor) {
      const gap = prompt.slice(cursor, span.start)
      if (!isSkeleton(gap) && gap.trim()) {
        emit({
          kind: 'base',
          source: 'pi',
          chars: span.start - cursor,
          start: cursor,
          end: span.start,
        })
      } else {
        span.start = cursor
      }
    }
    emit({
      kind: span.kind,
      source: span.owner.source,
      ...(span.owner.path ? { ownerPath: span.owner.path } : {}),
      ...(span.owner.name ? { ownerName: span.owner.name } : {}),
      ...(span.tools ? { tools: span.tools } : {}),
      chars: span.end - span.start,
      start: span.start,
      end: span.end,
    })
    cursor = span.end
  }
  if (cursor < prompt.length) {
    const tail = prompt.slice(cursor)
    if (!isSkeleton(tail) && tail.trim()) {
      emit({
        kind: 'base',
        source: 'pi',
        chars: prompt.length - cursor,
        start: cursor,
        end: prompt.length,
      })
    } else if (parts.length > 0) {
      const last = parts[parts.length - 1]
      if (last.end !== undefined) {
        last.end = prompt.length
        last.chars += prompt.length - cursor
      }
    } else {
      parts.push({ kind: 'base', source: 'pi', chars: prompt.length, start: 0, end: prompt.length })
    }
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
