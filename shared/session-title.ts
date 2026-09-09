/** Derives the fallback session title from a user message.
 *  This is the single rule shared by the persisted-session scan and the browser's
 *  immediate row title, so a title never changes when a refresh replaces it:
 *  whitespace-normalized text truncated to its first 8 words. */
export function fallbackSessionTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const words = normalized.split(' ')
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : normalized
}
