// The sidebar formats every session row on each render, so the formatters are built once
// rather than per call.
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** Formats a session timestamp as a compact sidebar column value.
 *  Same-year values show the time; older values trade the time for the year. */
export function formatSessionTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp)
  const day = dayFormat.format(date)
  if (date.getFullYear() !== new Date(now).getFullYear()) return `${day} ${date.getFullYear()}`
  return `${day} ${timeFormat.format(date)}`
}
