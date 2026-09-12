import { isObject } from '../../../../shared/is-object.ts'
import { truncateToolText, type ToolCallPresentation } from './shared.ts'

/**
 * Shows the delegated task in the header with the resolved effort and model as
 * a suffix chip. The chip needs the extension-reported result details, so it
 * appears only once the run has settled; live progress already carries the
 * effort and tool budget in its streamed text.
 */
export function subagentPresentation(
  args: unknown,
  _repositoryRoot?: string | null,
  details?: unknown,
): ToolCallPresentation {
  const task = taskText(args)
  if (task === undefined) return {}

  const suffix = resolvedDetail(details)
  return {
    headerDetail: {
      text: truncateToolText(task, 80).text,
      title: task,
      ...(suffix ? { suffix } : {}),
    },
  }
}

/** Accepts both agents' primary argument names: repo-explore's task and web-research's question. */
function taskText(args: unknown): string | undefined {
  if (!isObject(args)) return undefined
  if (typeof args.task === 'string' && args.task.trim()) return args.task
  if (typeof args.question === 'string' && args.question.trim()) return args.question
  return undefined
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
