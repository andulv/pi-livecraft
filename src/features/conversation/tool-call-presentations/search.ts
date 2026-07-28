import { isObject } from '../../../../shared/is-object.ts'
import { pathFromRepositoryRoot, truncateToolText, type ToolCallPresentation } from './shared.ts'

/** Exposes the pattern and optional scope without duplicating the two search tools' presentation. */
export function searchPresentation(
  args: unknown,
  repositoryRoot?: string | null,
): ToolCallPresentation {
  if (!isObject(args) || typeof args.pattern !== 'string') return {}

  const path = typeof args.path === 'string'
    ? pathFromRepositoryRoot(args.path, repositoryRoot)
    : undefined
  const detail = path ? `${args.pattern} · ${path}` : args.pattern
  return { headerDetail: { text: truncateToolText(detail, 80).text, title: detail } }
}
