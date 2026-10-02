/** Parses an SSE resume offset from a Last-Event-ID header or query value. */
export function parseSseLastEventId(value: unknown): number | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}
