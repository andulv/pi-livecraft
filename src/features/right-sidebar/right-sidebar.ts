export const rightWidgetDefinitions = [
  { id: 'index', label: 'Session index' },
  { id: 'analysis', label: 'Session analysis' },
  { id: 'git', label: 'Git' },
  { id: 'quotas', label: 'Quotas' },
  { id: 'todo', label: 'Todo' },
  { id: 'environment', label: 'Session environment' },
] as const

export type RightWidget = typeof rightWidgetDefinitions[number]['id']

export function isRightWidget(value: string | null): value is RightWidget {
  return rightWidgetDefinitions.some(({ id }) => id === value)
}

/** Restores the saved panel, defaulting to the always-available session index. */
export function readActiveRightWidget(
  value: string | null,
  legacyGitSidebarCollapsed: string | null,
): RightWidget | null {
  if (isRightWidget(value)) return value
  if (value === 'none') return null
  return legacyGitSidebarCollapsed === 'true' ? null : 'index'
}

export const defaultRightSidebarWidth = 300
export const minRightSidebarWidth = 240
export const maxRightSidebarWidth = 720

export function clampRightSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return defaultRightSidebarWidth
  return Math.min(maxRightSidebarWidth, Math.max(minRightSidebarWidth, Math.round(width)))
}

export function readRightSidebarWidth(value: string | null): number {
  return value === null ? defaultRightSidebarWidth : clampRightSidebarWidth(Number(value))
}
