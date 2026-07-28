import { Tooltip } from '../../../components/Tooltip.tsx'

/** Renders the session name and working directory, with a dot when Pi is active. */
export function SessionInfo({ name, cwd, active }: {
  name: string
  cwd: string
  active: boolean
}) {
  return (
    <div className='composer-session'>
      {active && (
        <span aria-label='Pi is active' className='session-status-indicator working' role='img' />
      )}
      <strong>{name}</strong>
      <Tooltip label={cwd}>
        <span>{cwd}</span>
      </Tooltip>
    </div>
  )
}
