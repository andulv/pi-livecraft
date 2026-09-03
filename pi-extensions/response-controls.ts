import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { isObject } from '../shared/is-object.ts'
import {
  latestResponseControlsState,
  parseResponseControlsArgs,
  responseControlsProtocol,
  supportsResponseControls,
  type ResponseControlsState,
} from '../shared/response-controls.ts'
import type { ResponseSummary, ResponseVerbosity } from '../shared/types.ts'

/**
 * Applies per-session Responses-API overrides — `text.verbosity` and
 * `reasoning.summary` — for GPT-5.x models on OpenAI, OpenAI Codex, and Azure
 * OpenAI Responses. State persists as a session entry, so it survives reopening
 * and Pi Livecraft reads it straight from the entries the snapshot already
 * fetches. Hidden until the manager restart loads this extension, the private
 * `/livecraft-response-controls` command is what the composer invokes.
 */
export default function registerResponseControls(pi: ExtensionAPI): void {
  let state: ResponseControlsState = {}

  pi.on('session_start', (_event, ctx) => {
    state = restore(ctx)
  })
  pi.on('session_tree', (_event, ctx) => {
    state = restore(ctx)
  })

  pi.registerCommand('livecraft-response-controls', {
    description: 'Set Pi Livecraft response verbosity and reasoning summary',
    handler: async (args, ctx) => {
      const command = parseResponseControlsArgs(args)
      if (command.invalid !== undefined) {
        ctx.ui.notify(`Unknown response-controls input: ${command.invalid}`, 'warning')
        return
      }
      if (command.verbosity !== undefined) {
        state = withVerbosity(
          state,
          command.verbosity === 'default' ? undefined : command.verbosity,
        )
      }
      if (command.summary !== undefined) {
        state = withSummary(state, command.summary === 'default' ? undefined : command.summary)
      }
      pi.appendEntry(responseControlsProtocol, state)
    },
  })

  pi.on('before_provider_request', (event, ctx) => {
    if (!supportsResponseControls(ctx.model)) return
    const payload = event.payload
    if (!isObject(payload)) return
    let modified: JsonObject = payload
    let changed = false
    if (state.verbosity !== undefined) {
      const existingText = isObject(modified.text) ? modified.text : {}
      modified = { ...modified, text: { ...existingText, verbosity: state.verbosity } }
      changed = true
    }
    if (state.summary !== undefined) {
      const existingReasoning = isObject(modified.reasoning) ? modified.reasoning : {}
      modified = { ...modified, reasoning: { ...existingReasoning, summary: state.summary } }
      changed = true
    }
    if (!changed) return
    return modified
  })
}

/** Restores the newest state entry on the active branch of the current session. */
function restore(ctx: ExtensionContext): ResponseControlsState {
  return latestResponseControlsState(
    ctx.sessionManager.getEntries(),
    ctx.sessionManager.getLeafId(),
  )
}

function withVerbosity(
  state: ResponseControlsState,
  verbosity: ResponseVerbosity | undefined,
): ResponseControlsState {
  const next = { ...state }
  if (verbosity === undefined) delete next.verbosity
  else next.verbosity = verbosity
  return next
}

function withSummary(
  state: ResponseControlsState,
  summary: ResponseSummary | undefined,
): ResponseControlsState {
  const next = { ...state }
  if (summary === undefined) delete next.summary
  else next.summary = summary
  return next
}
