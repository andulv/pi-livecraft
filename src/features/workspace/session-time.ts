/** Formats a session timestamp as a compact sidebar column value.
 *  Same-year values show the time; older values trade the time for the year. */
export function formatSessionTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp)
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (date.getFullYear() !== new Date(now).getFullYear()) return `${day} ${date.getFullYear()}`
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${day} ${time}`
}
