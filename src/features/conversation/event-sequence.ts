/** Advances a replay sequence, rejecting events already applied. */
export function advanceEventSequence(current: number, incoming?: number): number | null {
  if (incoming === undefined) return current
  return incoming <= current ? null : incoming
}
