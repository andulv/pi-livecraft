/**
 * The `shub-agents` extension: one generic `shub_agent` tool that dispatches one
 * named, declaratively defined agent per call.
 *
 * Agent behavior lives in Markdown profiles (see `profile.ts`); this file owns
 * host policy — settings, validation, run assembly, and result shaping. It
 * contains no agent-specific prompt text. Each run is a bounded one-shot child
 * Pi process (`runner.ts`) that persists its own session with durable ownership
 * (`session-marker.ts`) and a hard tool-call ceiling (`budget-guard.ts`).
 *
 * Implements the generic `shub_agent` extension.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { access, open, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  sessionIdFromFilePath,
  shubAgentSessionName,
  shubMarkerFromEntry,
} from '../../shared/shub-agent-session.ts'
import type { ExtensionSettingGroup } from '../../shared/extension-settings.ts'
import {
  numberSetting,
  publishExtensionSettings,
  resolveExtensionSettings,
  stringSetting,
} from '../extension-settings-store.ts'
import {
  catalogSelection,
  defaultProfileDirectories,
  discoverProfiles,
  EFFORT_LEVELS,
  EFFORT_PRESETS,
  projectProfileDirectory,
  toolDescription,
  type EffortLevel,
  type ProfileDirectory,
} from './profile.ts'
import { findShubSessionPath, runShubChild, type ShubProgress } from './runner.ts'

const extensionDirectory = dirname(fileURLToPath(import.meta.url))
const SESSION_MARKER_EXTENSION = resolve(extensionDirectory, 'session-marker.ts')
const BUDGET_GUARD_EXTENSION = resolve(extensionDirectory, 'budget-guard.ts')

const DEFAULT_PI_BIN = 'pi'
const DEFAULT_MODEL = ''
const DEFAULT_FFF_EXTENSION = '/home/anders/.pi/agent/npm/node_modules/@ff-labs/pi-fff/src/index.ts'
const DEFAULT_THINKING = 'off'
const DEFAULT_EFFORT = 'standard'
const DEFAULT_MAX_OUTPUT_CHARS = 30_000
const MAX_TIMEOUT_MS = 3_600_000
const SESSION_HEAD_BYTES = 8192

/**
 * The tool registry: profile tool names map to providers. Built-in tools need
 * no extension; the FFF search tools load the FFF extension, whose path is the
 * `fffExtension` setting. Any other tool name makes a profile invalid.
 */
const BUILTIN_TOOLS = ['read', 'edit', 'write', 'bash', 'grep', 'find', 'ls'] as const
const FFF_TOOLS = ['fffind', 'ffgrep'] as const
const KNOWN_TOOLS: ReadonlySet<string> = new Set([...BUILTIN_TOOLS, ...FFF_TOOLS])

/** Settings published to `~/.pi/agent/extension-settings.json` for every settings UI. */
export const SHUB_SETTINGS: ExtensionSettingGroup = {
  name: 'shub-agents',
  description: 'Bounded delegated agents behind the shub_agent tool.',
  settings: [
    {
      id: 'model',
      label: 'Default model',
      description: 'Model used when a profile omits one; empty lets the child use its own default.',
      type: 'string',
      defaultValue: DEFAULT_MODEL,
      env: 'PI_SHUB_MODEL',
      effect: 'next-call',
    },
    {
      id: 'thinking',
      label: 'Thinking level',
      description: 'Reasoning level used when a profile omits one.',
      type: 'enum',
      options: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      defaultValue: DEFAULT_THINKING,
      env: 'PI_SHUB_THINKING',
      effect: 'next-call',
    },
    {
      id: 'effort',
      label: 'Default effort',
      description: 'Timeout and tool-call budget used when a call and profile omit effort.',
      type: 'enum',
      options: [...EFFORT_LEVELS],
      defaultValue: DEFAULT_EFFORT,
      env: 'PI_SHUB_EFFORT',
      effect: 'next-call',
    },
    {
      id: 'timeoutMs',
      label: 'Timeout override (ms)',
      description:
        'Overrides the effort preset timeout (90 s quick, 240 s standard, 600 s deep) when set.',
      type: 'number',
      minimum: 1_000,
      env: 'PI_SHUB_TIMEOUT_MS',
      effect: 'next-call',
      advanced: true,
    },
    {
      id: 'maxOutputChars',
      label: 'Maximum output characters',
      description: 'Report length returned to the calling agent before truncation.',
      type: 'number',
      minimum: 1_000,
      defaultValue: DEFAULT_MAX_OUTPUT_CHARS,
      env: 'PI_SHUB_MAX_OUTPUT_CHARS',
      effect: 'next-call',
      advanced: true,
    },
    {
      id: 'fffExtension',
      label: 'FFF extension path',
      description: 'Entry file of the pi-fff extension loaded when a profile uses fffind/ffgrep.',
      type: 'string',
      defaultValue: DEFAULT_FFF_EXTENSION,
      env: 'PI_SHUB_FFF_EXTENSION',
      effect: 'next-call',
      advanced: true,
    },
    {
      id: 'piExecutable',
      label: 'Pi executable',
      description: 'Path of the pi binary used for the child run.',
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

  // The catalog is built from bundled and user profiles at load time; trusted
  // project profiles are additionally accepted at call time even when they are
  // not advertised here.
  const discovered = await discoverProfiles(
    defaultProfileDirectories(extensionDirectory),
    KNOWN_TOOLS,
  )
  for (const diagnostic of discovered.diagnostics) {
    console.warn(`shub-agents: ${diagnostic.path}: ${diagnostic.reason}`)
  }
  const catalog = catalogSelection(discovered.profiles)
  for (const omitted of catalog.omitted) {
    console.warn(`shub-agents: agent '${omitted}' is not advertised; the catalog budget is full`)
  }

  pi.registerTool({
    name: 'shub_agent',
    label: 'Shub agent',
    description: toolDescription(catalog.included),
    parameters: Type.Object({
      agent: Type.String({ description: 'Name of an available agent profile.' }),
      task: Type.String({
        description:
          'What to find, summarize, or research, and what evidence to return. Also becomes the child session name.',
      }),
      effort: Type.Optional(
        Type.String({
          description:
            'quick (6/8 tool calls, 90 s limit), standard (12/16, 4 min limit), or deep (24/32, 10 min limit). Defaults to the profile default, then the configured effort.',
        }),
      ),
      images: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Image or screenshot paths for the agent to look at. Relative paths resolve from cwd; requires a vision-capable model.',
        }),
      ),
      cwd: Type.Optional(
        Type.String({
          description:
            'Directory the child runs in, and where its session is stored. Defaults to the current workspace.',
        }),
      ),
      model: Type.Optional(
        Type.String({ description: 'Model override for this call.' }),
      ),
      timeoutMs: Type.Optional(
        Type.Number({
          description:
            'Timeout override in milliseconds for this call, clamped between 1 s and 1 h.',
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (
        params.timeoutMs !== undefined
        && (!Number.isFinite(params.timeoutMs) || params.timeoutMs < 1_000)
      ) throw new Error('timeoutMs must be a finite number >= 1000.')

      // Resolved per call so a setting saved in any UI applies to the next call.
      const settings = await resolveExtensionSettings(SHUB_SETTINGS)
      const piExecutable = stringSetting(settings, 'piExecutable') ?? DEFAULT_PI_BIN
      const fffExtension = stringSetting(settings, 'fffExtension') ?? DEFAULT_FFF_EXTENSION
      const maxOutputChars = numberSetting(settings, 'maxOutputChars') ?? DEFAULT_MAX_OUTPUT_CHARS

      // Rediscovered per call so edited or removed profiles never run stale.
      const directories: ProfileDirectory[] = [...defaultProfileDirectories(extensionDirectory)]
      if (ctx.isProjectTrusted()) {
        directories.push({ label: 'project', path: projectProfileDirectory(ctx.cwd) })
      }
      const { profiles, diagnostics } = await discoverProfiles(directories, KNOWN_TOOLS)
      for (const diagnostic of diagnostics) {
        console.warn(`shub-agents: ${diagnostic.path}: ${diagnostic.reason}`)
      }

      const agentName = params.agent.trim()
      const profile = profiles.find((candidate) => candidate.name === agentName)
      if (!profile) {
        const available = profiles.map((candidate) => candidate.name)
        throw new Error(
          available.length > 0
            ? `Unknown agent '${agentName}'. Available: ${available.join(', ')}.`
            : `Unknown agent '${agentName}'. No valid profiles are available.`,
        )
      }

      const effort = (params.effort?.trim() || profile.defaultEffort
        || stringSetting(settings, 'effort') || DEFAULT_EFFORT) as EffortLevel
      if (!EFFORT_LEVELS.includes(effort)) {
        throw new Error(`Invalid effort '${effort}'. Expected one of: ${EFFORT_LEVELS.join(', ')}.`)
      }
      const preset = EFFORT_PRESETS[effort]
      const timeoutMs = Math.min(
        MAX_TIMEOUT_MS,
        Math.max(
          1_000,
          params.timeoutMs ?? numberSetting(settings, 'timeoutMs') ?? preset.timeoutMs,
        ),
      )

      const model = params.model?.trim() || profile.model || stringSetting(settings, 'model') || ''
      const thinking = profile.thinking ?? stringSetting(settings, 'thinking') ?? DEFAULT_THINKING

      const cwd = params.cwd ? resolve(ctx.cwd, params.cwd.replace(/^@/, '')) : ctx.cwd
      if (!(await stat(cwd)).isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`)

      const usesFff = profile.tools.some((tool) => (FFF_TOOLS as readonly string[]).includes(tool))
      if (usesFff) await access(fffExtension)

      const images: string[] = []
      for (const image of params.images ?? []) {
        const imagePath = resolve(cwd, image.replace(/^@/, ''))
        await access(imagePath)
        images.push(imagePath)
      }

      const ownerSessionId = sessionIdFromFilePath(ctx.sessionManager.getSessionFile())
      const sessionName = shubAgentSessionName(profile.name, params.task.trim())
      const systemPrompt = `${profile.body}

Effort: ${effort}. ${preset.guidance}
Soft target: ${preset.softToolCalls} tool calls. At or before this target, stop expanding scope and synthesize unless one essential evidence gap remains.
Hard ceiling: ${preset.hardToolCalls} tool calls. Further calls are blocked; if blocked, synthesize immediately from the evidence you already have.`

      const report = (progress: ShubProgress): void => {
        onUpdate?.({
          content: [{ type: 'text', text: progress.text }],
          details: {
            agent: profile.name,
            cwd,
            model: model || undefined,
            effort,
            timeoutMs,
            sessionId: progress.sessionId,
            ownerSessionId,
            turnCount: progress.turnCount,
            toolCount: progress.toolCount,
            softToolCalls: preset.softToolCalls,
            hardToolCalls: preset.hardToolCalls,
            totalTokens: progress.totalTokens,
            costUsd: progress.costUsd,
            elapsedMs: progress.elapsedMs,
          },
        })
      }

      onUpdate?.({
        content: [{
          type: 'text',
          text: `Starting shub-agent ${profile.name} [${effort}]${
            model ? ` with ${model}` : ' with the default model'
          }...`,
        }],
        details: { agent: profile.name, cwd, model: model || undefined, effort, timeoutMs },
      })

      const result = await runShubChild({
        piExecutable,
        extensions: usesFff
          ? [SESSION_MARKER_EXTENSION, BUDGET_GUARD_EXTENSION, fffExtension]
          : [SESSION_MARKER_EXTENSION, BUDGET_GUARD_EXTENSION],
        tools: profile.tools,
        providerArgs: usesFff ? ['--fff-mode', 'tools-only'] : [],
        providerEnv: usesFff ? { PI_FFF_MODE: 'tools-only', PI_FFF_MULTIGREP: '0' } : {},
        cwd,
        task: params.task,
        images,
        ownerSessionId,
        agentName: profile.name,
        sessionName,
        systemPrompt,
        model,
        thinking,
        effort,
        softToolCalls: preset.softToolCalls,
        hardToolCalls: preset.hardToolCalls,
        timeoutMs,
        maxOutputChars,
        projectContext: profile.projectContext,
        signal,
        onProgress: report,
      })

      const sessionPath = result.sessionId
        ? await findShubSessionPath(cwd, result.sessionId, ctx.sessionManager.getSessionFile())
        : undefined
      const ownershipMarker = sessionPath ? await sessionHasMarker(sessionPath) : false
      const body = result.text.trim() || result.stderr.trim()
      const truncated = body.length > maxOutputChars
      const brief = truncated
        ? `${body.slice(0, maxOutputChars)}\n\n[Output truncated at ${maxOutputChars} characters.]`
        : body

      if (result.code !== 0) {
        throw new Error(brief || `shub-agent failed with exit code ${result.code}.`)
      }
      if (!result.text.trim()) {
        throw new Error(result.stderr.trim() || 'shub-agent completed without a report.')
      }

      const header = `shub-agent ${profile.name} [${effort}] · ${
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
          agent: profile.name,
          cwd,
          model: model || undefined,
          effort,
          timeoutMs,
          sessionId: result.sessionId,
          sessionPath,
          ownerSessionId,
          ownershipMarker,
          turnCount: result.turnCount,
          toolCount: result.toolCount,
          softToolCalls: preset.softToolCalls,
          hardToolCalls: preset.hardToolCalls,
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

/** Reads the child session head and reports whether the ownership marker was persisted. */
async function sessionHasMarker(sessionPath: string): Promise<boolean> {
  try {
    const handle = await open(sessionPath, 'r')
    try {
      const buffer = Buffer.alloc(SESSION_HEAD_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, SESSION_HEAD_BYTES, 0)
      const lines = buffer.toString('utf8', 0, bytesRead).split('\n')
      for (const line of lines) {
        try {
          if (shubMarkerFromEntry(JSON.parse(line))) return true
        } catch {
          // Not JSON; session files are line-delimited JSON so this is only padding.
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
