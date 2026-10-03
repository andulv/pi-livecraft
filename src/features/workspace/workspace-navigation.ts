import type { GitWorkspace } from '../../../shared/types.ts'

const preferredCardWidth = 200
const gap = 6
const moreWidth = 80

/** Reserve main and the active worktree before filling slots in discovery order.
 * At narrow widths those two cards shrink instead of hiding the active workspace.
 */
export function workspaceNavigation(
  workspaces: readonly GitWorkspace[],
  selectedPath: string,
  availableWidth: number,
): { visible: GitWorkspace[]; overflow: GitWorkspace[]; cardWidth: number } {
  const ordered = [
    ...workspaces.filter(({ main }) => main),
    ...workspaces.filter(({ main }) => !main),
  ]
  const essential = ordered.filter(({ main, path }) => main || path === selectedPath)
  const width = Math.max(0, availableWidth)
  const allFit = ordered.length * (preferredCardWidth + gap) - gap <= width
  const slots = allFit
    ? ordered.length
    : Math.min(
      ordered.length,
      Math.max(essential.length, 1, Math.floor((width - moreWidth) / (preferredCardWidth + gap))),
    )
  const paths = new Set(essential.map(({ path }) => path))
  for (const workspace of ordered) {
    if (paths.size >= slots) break
    paths.add(workspace.path)
  }
  const visible = ordered.filter(({ path }) => paths.has(path))
  const overflow = ordered.filter(({ path }) => !paths.has(path))
  const reserved = overflow.length ? moreWidth + gap : 0
  const cardWidth = Math.max(
    1,
    Math.min(
      preferredCardWidth,
      (width - reserved - Math.max(0, visible.length - 1) * gap) / Math.max(1, visible.length),
    ),
  )
  return { visible, overflow, cardWidth }
}
