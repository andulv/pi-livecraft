export const defaultFilePaneShare = 0.5
export const minFilePaneShare = 0.25
export const maxFilePaneShare = 0.75

export function clampFilePaneShare(share: number): number {
  if (!Number.isFinite(share)) return defaultFilePaneShare
  const bounded = Math.min(maxFilePaneShare, Math.max(minFilePaneShare, share))
  return Math.round(bounded * 1_000) / 1_000
}

export function readFilePaneShare(value: string | null): number {
  return value === null ? defaultFilePaneShare : clampFilePaneShare(Number(value))
}
