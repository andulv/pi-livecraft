import { isObject } from '../../../../shared/is-object.ts'
import { filePresentation } from './file.ts'
import { readLineRange, type ToolCallPresentation } from './shared.ts'

/** Completes the read path with an always-visible range distinct from truncated text. */
export function readPresentation(
  args: unknown,
  repositoryRoot?: string | null,
): ToolCallPresentation {
  const presentation = filePresentation(args, repositoryRoot)
  if (!presentation.headerDetail || !isObject(args)) return presentation

  const range = readLineRange(args)
  return range ? { headerDetail: { ...presentation.headerDetail, suffix: range } } : presentation
}
