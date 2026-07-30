import { CompactingIcon } from '../../components/CompactingIcon.tsx'
import { activityActionText, activityAgentName, type Activity } from './activity.ts'

/** Displays Pi's current work state in the conversation thread. */
export function ActivityIndicator(
  { activity, agentName }: { activity: Activity; agentName?: string },
) {
  return (
    <div className={`pi-activity is-${activity.kind}`} role='status'>
      <span
        aria-hidden='true'
        className={`activity-signal${
          activity.kind === 'compacting'
            ? ' compacting'
            : ''
        }`}
      >
        {activity.kind === 'compacting'
          ? <CompactingIcon />
          : (
            <>
              <i />
              <i />
              <i />
            </>
          )}
      </span>
      <span className='activity-text'>
        <span>{activityAgentName(agentName)}</span>{' '}
        <span className='activity-action' key={activity.kind}>{activityActionText(activity)}</span>
      </span>
    </div>
  )
}
