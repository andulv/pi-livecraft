import { memo } from 'react'
import type { SessionStats, SessionSummary } from '../../../../shared/types.ts'
import { formatSessionStats } from '../composer-utils.ts'
import { SessionInfo } from './SessionInfo.tsx'
import { SessionStats as SessionStatsBar } from './SessionStats.tsx'

/** Two-line session strip: identity on the first line, usage on the second.
    Workspace and Git context live in the sidebar; context usage in the composer. */
export const ChatTopBar = memo(function ChatTopBar(
  { session, running, compacting, stats }: {
    session: SessionSummary
    running: boolean
    compacting: boolean
    stats: SessionStats | null
  },
) {
  const formattedStats = formatSessionStats(stats)
  return (
    <div className='chat-topbar' aria-label='Session status'>
      <div className='chat-topbar-name'>
        {compacting
          ? (
            <div aria-label='Compaction in progress' className='composer-compacting' role='status'>
              <span aria-hidden='true' className='composer-compacting-spinner' /> Compacting…
            </div>
          )
          : <SessionInfo name={session.name} active={running} />}
      </div>
      <div className='chat-topbar-stats'>
        <SessionStatsBar {...formattedStats} />
      </div>
    </div>
  )
})
