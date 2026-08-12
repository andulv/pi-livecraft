const maxSessionTitleLength = 90

/** Builds a compact title from arbitrary text. */
export function promptSessionTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  return normalized.length > maxSessionTitleLength
    ? `${normalized.slice(0, maxSessionTitleLength - 1)}…`
    : normalized
}
