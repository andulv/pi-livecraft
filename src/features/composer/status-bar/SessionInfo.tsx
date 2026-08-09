/** Renders the labelled session name with a dot when Pi is active. */
export function SessionInfo({ name, active }: {
  name: string
  active: boolean
}) {
  return (
    <div className='composer-session'>
      <b>Session</b>
      {active && (
        <span aria-label='Pi is active' className='session-status-indicator working' role='img' />
      )}
      <strong title={name}>{name}</strong>
    </div>
  )
}
