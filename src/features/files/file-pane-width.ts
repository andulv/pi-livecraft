export const defaultFilePaneWidth = 480
export const minFilePaneWidth = 280
export const maxFilePaneWidth = 960

export function clampFilePaneWidth(width: number): number {
  if (!Number.isFinite(width)) return defaultFilePaneWidth
  return Math.min(maxFilePaneWidth, Math.max(minFilePaneWidth, Math.round(width)))
}

export function readFilePaneWidth(value: string | null): number {
  return value === null ? defaultFilePaneWidth : clampFilePaneWidth(Number(value))
}
