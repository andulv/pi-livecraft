import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'
import { access, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  sessionIdFromFilePath,
  shubAgentSessionName,
  shubMarkerFromEntry,
} from '../../shared/shub-agent-session.ts'
import type { ExtensionSettingGroup } from '../../shared/extension-settings.ts'
import {
  publishExtensionSettings,
  resolveExtensionSettings,
  stringSetting,
} from '../extension-settings-store.ts'
import { subagents } from './agents/index.ts'
import { composeSubagentPrompt, MAX_REPORT_CHARS, type SubagentDefinition } from './define.ts'
import { findShubSessionPath, runShubChild, type ShubProgress } from './runner.ts'

const extensionDirectory = dirname(fileURLToPath(import.meta.url))
const SESSION_MARKER_EXTENSION = resolve(extensionDirectory, 'session-marker.ts')
const BUDGET_GUARD_EXTENSION = resolve(extensionDirectory, 'budget-guard.ts')
const DEFAULT_PI_BIN = 'pi'
const DEFAULT_FFF_EXTENSION = '/home/anders/.pi/agent/npm/node_modules/@ff-labs/pi-fff/src/index.ts'
const SESSION_HEAD_BYTES = 8192

export const SHUB_SETTINGS: ExtensionSettingGroup = {
  name: 'shub-agents',
  description: 'Environment paths used by bounded delegated agents.',
  settings: [
    {
      id: 'fffExtension',
      label: 'FFF extension path',
      description: 'Entry file loaded when an agent declares fffind or ffgrep.',
      type: 'string',
      defaultValue: DEFAULT_FFF_EXTENSION,
      env: 'PI_SHUB_FFF_EXTENSION',
      effect: 'next-call',
      advanced: true,
    },
    {
      id: 'piExecutable',
      label: 'Pi executable',
      description: 'Path of the pi binary used for child runs.',
      type: 'string',
      defaultValue: DEFAULT_PI_BIN,
      env: 'PI_SHUB_PI',
      effect: 'next-call',
      advanced: true,
    },
  ],
}

export default async function registerShubAgents(pi: ExtensionAPI): Promise<void> {
  pi.on('session_start', async () => {
    await publishExtensionSettings(SHUB_SETTINGS)
  })

  for (const agent of subagents) registerSubagent(pi, agent)
}

type SharedRunParameters = {
  effort?: string
  max_chars?: number
  images?: string[]
}

function registerSubagent<TArguments extends Record<string, unknown>>(
  pi: ExtensionAPI,
  agent: SubagentDefinition<TArguments>,
): void {
  const effortNames = Object.keys(agent.effort)
  const effortParameter = effortNames.length > 1
    ? {
      effort: Type.Optional(
        StringEnum(effortNames as [string, ...string[]], {
          description: effortDescription(agent),
        }),
      ),
    }
    : {}
  const imageParameter = agent.images
    ? {
      images: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Image paths to inspect. Relative paths resolve from the workspace.',
        }),
      ),
    }
    : {}
  const parameters = Type.Object({
    ...agent.parameters.properties,
    ...effortParameter,
    max_chars: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_REPORT_CHARS,
        default: agent.maxOutputChars,
        description:
          `Maximum characters in the returned report. Pick the size you want: ~1500 for a terse answer, ~6000 for a focused report, ${agent.maxOutputChars}+ for a full investigation. This limits the report, not the investigation.`,
      }),
    ),
    ...imageParameter,
  })

  pi.registerTool({
    name: `subagent_${agent.name}`,
    label: agent.name.replaceAll('_', ' '),
    description: effortNames.length === 1
      ? `${agent.description} ${effortDescription(agent)}`
      : agent.description,
    promptSnippet: agent.promptSnippet,
    promptGuidelines: agent.promptGuidelines ? [...agent.promptGuidelines] : undefined,
    parameters,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const runParams = params as TArguments & SharedRunParameters
      const effortName = runParams.effort ?? agent.defaultEffort
      const effort = agent.effort[effortName]
      if (!effort) throw new Error(`Unknown effort '${effortName}'.`)
      const maxOutputChars = runParams.max_chars ?? agent.maxOutputChars
      const task = agent.task(runParams).trim()
      if (!task) throw new Error('Subagent task must not be empty.')

      const settings = await resolveExtensionSettings(SHUB_SETTINGS)
      const piExecutable = stringSetting(settings, 'piExecutable') ?? DEFAULT_PI_BIN
      const fffExtension = stringSetting(settings, 'fffExtension') ?? DEFAULT_FFF_EXTENSION
      const usesFff = agent.tools.some((tool) => tool === 'fffind' || tool === 'ffgrep')
      if (usesFff) await access(fffExtension)

      const images: string[] = []
      for (const image of runParams.images ?? []) {
        const imagePath = resolve(ctx.cwd, image.replace(/^@/, ''))
        await access(imagePath)
        images.push(imagePath)
      }

      const ownerSessionId = sessionIdFromFilePath(ctx.sessionManager.getSessionFile())
      const report = (progress: ShubProgress): void => {
        onUpdate?.({
          content: [{ type: 'text', text: progress.text }],
          details: {
            agent: agent.name,
            cwd: ctx.cwd,
            model: agent.model,
            effort: effortName,
            timeoutMs: effort.timeoutMs,
            maxOutputChars,
            sessionId: progress.sessionId,
            ownerSessionId,
            turnCount: progress.turnCount,
            toolCount: progress.toolCount,
            softToolCalls: effort.softToolCalls,
            hardToolCalls: effort.hardToolCalls,
            totalTokens: progress.totalTokens,
            costUsd: progress.costUsd,
            elapsedMs: progress.elapsedMs,
          },
        })
      }

      const result = await runShubChild({
        piExecutable,
        extensions: usesFff
          ? [SESSION_MARKER_EXTENSION, BUDGET_GUARD_EXTENSION, fffExtension]
          : [SESSION_MARKER_EXTENSION, BUDGET_GUARD_EXTENSION],
        tools: [...agent.tools],
        providerArgs: usesFff ? ['--fff-mode', 'tools-only'] : [],
        providerEnv: usesFff ? { PI_FFF_MODE: 'tools-only', PI_FFF_MULTIGREP: '0' } : {},
        cwd: ctx.cwd,
        task,
        images,
        ownerSessionId,
        agentName: agent.name,
        sessionName: shubAgentSessionName(agent.name, task),
        systemPrompt: composeSubagentPrompt(
          agent.systemPrompt,
          effortName,
          effort,
          maxOutputChars,
        ),
        model: agent.model,
        thinking: agent.thinking,
        effort: effortName,
        softToolCalls: effort.softToolCalls,
        hardToolCalls: effort.hardToolCalls,
        timeoutMs: effort.timeoutMs,
        maxOutputChars,
        signal,
        onProgress: report,
      })

      const sessionPath = result.sessionId
        ? await findShubSessionPath(ctx.cwd, result.sessionId, ctx.sessionManager.getSessionFile())
        : undefined
      const ownershipMarker = sessionPath ? await sessionHasMarker(sessionPath) : false
      const body = result.text.trim() || result.stderr.trim()
      const truncated = body.length > maxOutputChars
      const brief = truncated
        ? `${body.slice(0, maxOutputChars)}\n\n[Output truncated at ${maxOutputChars} characters.]`
        : body

      if (result.code !== 0)
        throw new Error(brief || `subagent_${agent.name} failed with exit code ${result.code}.`)
      if (!result.text.trim())
        throw new Error(
          result.stderr.trim() || `subagent_${agent.name} completed without a report.`,
        )

      const header = `${agent.name} [${effortName}] · ${
        Math.round(result.elapsedMs / 1000)
      }s · ${result.toolCount} tool calls · ${result.totalTokens} tokens · $${
        result.costUsd.toFixed(4)
      }${sessionPath ? `\nSession: ${sessionPath}` : ''}${
        ownershipMarker
          ? ''
          : '\nOwnership marker missing: this session will not group under its owner.'
      }`

      return {
        content: [{ type: 'text', text: `${header}\n\n${brief}` }],
        details: {
          agent: agent.name,
          cwd: ctx.cwd,
          model: agent.model,
          effort: effortName,
          timeoutMs: effort.timeoutMs,
          maxOutputChars,
          sessionId: result.sessionId,
          sessionPath,
          ownerSessionId,
          ownershipMarker,
          turnCount: result.turnCount,
          toolCount: result.toolCount,
          softToolCalls: effort.softToolCalls,
          hardToolCalls: effort.hardToolCalls,
          totalTokens: result.totalTokens,
          costUsd: result.costUsd,
          elapsedMs: result.elapsedMs,
          truncated,
          stderr: result.stderr.slice(0, 10_000),
        },
      }
    },
  })
}

function effortDescription(agent: SubagentDefinition): string {
  const levels = Object.entries(agent.effort).map(([name, effort]) =>
    `${name} (${
      Math.round(effort.timeoutMs / 1000)
    }s, ${effort.softToolCalls}/${effort.hardToolCalls} tool calls)`
  )
  return `Effort: ${levels.join(', ')}. Default: ${agent.defaultEffort}.`
}

async function sessionHasMarker(sessionPath: string): Promise<boolean> {
  try {
    const handle = await open(sessionPath, 'r')
    try {
      const buffer = Buffer.alloc(SESSION_HEAD_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, SESSION_HEAD_BYTES, 0)
      for (const line of buffer.toString('utf8', 0, bytesRead).split('\n')) {
        try {
          if (shubMarkerFromEntry(JSON.parse(line))) return true
        } catch {
          // Ignore the trailing partial line in the bounded session head.
        }
      }
      return false
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}
