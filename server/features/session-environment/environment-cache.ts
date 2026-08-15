import { isObject } from '../../../shared/is-object.ts'
import type {
  JsonObject,
  SessionEnvironmentContextFile,
  SessionEnvironmentReport,
  SessionEnvironmentSkill,
  SessionEnvironmentSnapshot,
  SessionEnvironmentTool,
  SessionEnvironmentToolParam,
} from '../../../shared/types.ts'

/** Keeps the last valid value of each section when a newer report omits it. */
export class EnvironmentCache {
  #tools: SessionEnvironmentTool[] = []
  #skills: SessionEnvironmentSkill[] = []
  #contextFiles: SessionEnvironmentContextFile[] = []
  #updatedAt: number | undefined
  #refreshing = false

  snapshot(sessionRequired: boolean): SessionEnvironmentSnapshot {
    return {
      tools: this.#tools,
      skills: this.#skills,
      contextFiles: this.#contextFiles,
      ...(this.#updatedAt !== undefined ? { updatedAt: this.#updatedAt } : {}),
      refreshing: this.#refreshing,
      sessionRequired,
    }
  }

  setRefreshing(refreshing: boolean): void {
    this.#refreshing = refreshing
  }

  /** Accepts only the private, versioned status emitted by the session-environment extension. */
  receiveManagerEvent(event: unknown): boolean {
    const data = object(object(event)?.data)
    if (
      object(event)?.event !== 'pi' || data?.type !== 'extension_ui_request' || data
          .method !== 'setStatus'
      || data.statusKey !== 'pi-livecraft.environment' || typeof data.statusText !== 'string'
    ) return false
    let parsed: unknown
    try {
      parsed = JSON.parse(data.statusText)
    } catch {
      return false
    }
    const report = parseEnvironmentReport(parsed)
    if (!report) return false
    if (report.tools) this.#tools = report.tools
    if (report.skills) this.#skills = report.skills
    if (report.contextFiles) this.#contextFiles = report.contextFiles
    this.#updatedAt = report.refreshedAt
    this.#refreshing = false
    return true
  }
}

function parseEnvironmentReport(value: unknown): SessionEnvironmentReport | undefined {
  const report = object(value)
  if (
    report?.protocol !== 'pi-livecraft.environment' || report.version !== 1
    || !finiteNumber(report.refreshedAt)
  ) return undefined
  const tools = report.tools === undefined ? undefined : parseArray(report.tools, parseTool)
  const skills = report.skills === undefined ? undefined : parseArray(report.skills, parseSkill)
  const contextFiles = report.contextFiles === undefined
    ? undefined
    : parseArray(report.contextFiles, parseContextFile)
  if (!tools && !skills && !contextFiles) return undefined
  return {
    protocol: 'pi-livecraft.environment',
    version: 1,
    refreshedAt: report.refreshedAt,
    ...(tools ? { tools } : {}),
    ...(skills ? { skills } : {}),
    ...(contextFiles ? { contextFiles } : {}),
  }
}

function parseArray<T>(
  value: unknown,
  parseItem: (value: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map(parseItem)
  return items.every((item): item is T => item !== undefined) ? items : undefined
}

function parseTool(value: unknown): SessionEnvironmentTool | undefined {
  const tool = object(value)
  if (
    !nonEmptyString(tool?.name) || typeof tool?.active !== 'boolean'
    || !nonEmptyString(tool?.source)
  ) return undefined
  const entry: SessionEnvironmentTool = {
    name: tool.name.slice(0, 120),
    active: tool.active,
    source: tool.source.slice(0, 60),
  }
  if (typeof tool.description === 'string' && tool.description)
    entry.description = tool.description.slice(0, 300)
  if (typeof tool.sourceName === 'string' && tool.sourceName)
    entry.sourceName = tool.sourceName.slice(0, 200)
  if (typeof tool.sourcePath === 'string' && tool.sourcePath)
    entry.sourcePath = tool.sourcePath.slice(0, 1000)
  if (finiteNumber(tool.estimatedContextChars) && tool.estimatedContextChars >= 0)
    entry.estimatedContextChars = Math.min(Math.floor(tool.estimatedContextChars), 10_000_000)
  if (tool.params !== undefined) {
    const params = parseArray(tool.params, parseToolParam)
    if (!params) return undefined
    if (params.length > 0) entry.params = params
  }
  return entry
}

function parseSkill(value: unknown): SessionEnvironmentSkill | undefined {
  const skill = object(value)
  if (!nonEmptyString(skill?.name) || !nonEmptyString(skill.path)) return undefined
  const entry: SessionEnvironmentSkill = {
    name: skill.name.slice(0, 120),
    path: skill.path.slice(0, 1000),
  }
  if (typeof skill.active === 'boolean') entry.active = skill.active
  if (finiteNumber(skill.contentChars) && skill.contentChars >= 0)
    entry.contentChars = Math.min(Math.floor(skill.contentChars), 10_000_000)
  if (nonEmptyString(skill.scope)) entry.scope = skill.scope.slice(0, 40)
  if (nonEmptyString(skill.origin)) entry.origin = skill.origin.slice(0, 40)
  if (nonEmptyString(skill.baseDir)) entry.baseDir = skill.baseDir.slice(0, 1000)
  return entry
}

function parseToolParam(value: unknown): SessionEnvironmentToolParam | undefined {
  const param = object(value)
  if (!nonEmptyString(param?.name)) return undefined
  const entry: SessionEnvironmentToolParam = { name: param.name.slice(0, 120) }
  if (typeof param.type === 'string' && param.type) entry.type = param.type.slice(0, 40)
  if (param.required === true) entry.required = true
  if (typeof param.description === 'string' && param.description)
    entry.description = param.description.slice(0, 200)
  return entry
}

function parseContextFile(value: unknown): SessionEnvironmentContextFile | undefined {
  const file = object(value)
  if (!nonEmptyString(file?.path) || !finiteNumber(file?.bytes) || file.bytes < 0) return undefined
  return { path: file.path.slice(0, 1000), bytes: file.bytes }
}

function object(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
