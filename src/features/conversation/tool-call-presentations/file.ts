import { isObject } from '../../../../shared/is-object.ts'
import { pathFromRepositoryRoot, truncateToolText, type ToolCallPresentation } from './shared.ts'

/** Displays a file path relative to the repository without hiding access outside it. */
export function filePresentation(
  args: unknown,
  repositoryRoot?: string | null,
): ToolCallPresentation {
  if (!isObject(args) || typeof args.path !== 'string') return {}

  const path = pathFromRepositoryRoot(args.path, repositoryRoot)
  return { headerDetail: { text: truncateToolText(path, 80).text, title: path } }
}
