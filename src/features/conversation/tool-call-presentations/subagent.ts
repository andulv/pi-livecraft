import { isObject } from '../../../../shared/is-object.ts'
import { shubCompactTokens, shubMeasurementLabel } from '../../../../shared/shub-agent-session.ts'
import { truncateToolText, type ToolCallPresentation } from './shared.ts'

/**
 * Shows the delegated task in the header with the resolved effort and model as
 * a suffix chip. The chip needs the extension-reported result details, so it
 * appears only once the run has settled; live progress already carries the
 * effort and tool budget in its streamed text. The full task is available in
 * `expandedInput` and `expandedArguments` so running and settled cards separate them from progress or results.
 */
export function subagentPresentation(
  args: unknown,
  _repositoryRoot?: string | null,
  details?: unknown,
): ToolCallPresentation {
  const task = taskText(args)
  if (task === undefined) return {}

  const chipParts = [resolvedDetail(details), measurement(details)].filter(
    (part) => part !== undefined,
  )
  const expandedMeasurement = measurementLabel(details)
  const expandedArguments = runArguments(args, details)
  return {
    headerDetail: {
      text: truncateToolText(task, 80).text,
      title: task,
      ...(chipParts.length > 0 ? { suffix: chipParts.join(' · ') } : {}),
    },
    expandedInput: task,
    ...(expandedArguments.length > 0 ? { expandedArguments } : {}),
    ...(expandedMeasurement !== undefined ? { expandedMeasurement } : {}),
  }
}

/** Accepts both agents' primary argument names: repo-explore's task and web-research's question. */
function taskText(args: unknown): string | undefined {
  if (!isObject(args)) return undefined
  if (typeof args.task === 'string' && args.task.trim()) return args.task
  if (typeof args.question === 'string' && args.question.trim()) return args.question
  return undefined
}

/** Formats the optional run limits passed to both subagent tools. */
function runArguments(
  args: unknown,
  details: unknown,
): { label: string; value: string }[] {
  const callArguments = isObject(args) ? args : {}
  const runDetails = isObject(details) ? details : {}
  const arguments_ = []
  const effort = typeof runDetails.effort === 'string'
    ? runDetails.effort
    : callArguments.effort
  if (typeof effort === 'string' && effort.trim()) {
    arguments_.push({ label: 'Mode', value: effort })
  }
  const maxOutputChars = typeof runDetails.maxOutputChars === 'number'
    ? runDetails.maxOutputChars
    : callArguments.max_chars
  if (
    typeof maxOutputChars === 'number' && Number.isSafeInteger(maxOutputChars) && maxOutputChars > 0
  ) {
    arguments_.push({ label: 'Output', value: `${maxOutputChars.toLocaleString()} characters` })
  }
  return arguments_
}

/** Renders the extension-reported effort and short model name from the run details. */
function resolvedDetail(details: unknown): string | undefined {
  if (!isObject(details)) return undefined
  const effort = typeof details.effort === 'string' ? details.effort : undefined
  const model = typeof details.model === 'string'
    ? details.model.split('/').at(-1) || undefined
    : undefined
  if (!effort && !model) return undefined
  return [effort, model].filter((part) => part !== undefined).join(' · ')
}

/** Compact chip: child tokens processed versus delivered report tokens,
 *  plus the final context size. */
function measurement(details: unknown): string | undefined {
  if (!isObject(details)) return undefined
  const { totalTokens, contextTokens, outputChars } = details
  if (typeof totalTokens !== 'number' || totalTokens <= 0) return undefined
  if (typeof outputChars !== 'number' || outputChars <= 0) return undefined
  const deliveredTokens = Math.round(outputChars / 4)
  const parts = [`${shubCompactTokens(totalTokens)}→${shubCompactTokens(deliveredTokens)} tok`]
  if (typeof contextTokens === 'number' && contextTokens > 0)
    parts.push(`${shubCompactTokens(contextTokens)} ctx`)
  return parts.join(' · ')
}

/** Full measurement label for the expanded view and session list tooltip. */
function measurementLabel(details: unknown): string | undefined {
  if (!isObject(details)) return undefined
  const { totalTokens, contextTokens, outputChars } = details
  if (typeof totalTokens !== 'number' || totalTokens <= 0) return undefined
  if (typeof outputChars !== 'number' || outputChars <= 0) return undefined
  return shubMeasurementLabel(
    totalTokens,
    outputChars,
    typeof contextTokens === 'number' && contextTokens > 0 ? contextTokens : undefined,
  )
}
