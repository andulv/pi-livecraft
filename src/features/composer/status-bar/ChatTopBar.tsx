import { memo } from 'react'
import type { SessionStats, SessionSummary } from '../../../../shared/types.ts'
import { formatSessionStats } from '../composer-utils.ts'
import { SessionInfo } from './SessionInfo.tsx'
import { SessionStats as SessionStatsBar } from './SessionStats.tsx'

export interface ChatTopBarGit {
  branch: string
  worktree: boolean
}

/** Full-width status strip pinned to the top of the chat window. */
export const ChatTopBar = memo(function ChatTopBar(
  { session, running, compacting, stats, git }: {
    session: SessionSummary
    running: boolean
    compacting: boolean
    stats: SessionStats | null
    git: ChatTopBarGit | null
  },
) {
  const { cost, contextClass, contextTokens, contextPercent, contextPercentValue } =
    formatSessionStats(
      stats,
    )
  return (
    <div className='chat-topbar' aria-label='Session status'>
      {compacting
        ? (
          <div aria-label='Compaction in progress' className='composer-compacting' role='status'>
            <span aria-hidden='true' className='composer-compacting-spinner' /> Compacting…
          </div>
        )
        : <SessionInfo name={session.name} cwd={session.cwd} active={running} />}
      {git && <SessionGit branch={git.branch} worktree={git.worktree} />}
      <SessionStatsBar
        cost={cost}
        contextClass={contextClass}
        contextTokens={contextTokens}
        contextPercent={contextPercent}
        contextPercentValue={contextPercentValue}
      />
    </div>
  )
})

function SessionGit({ branch, worktree }: { branch: string; worktree: boolean }) {
  return (
    <div className='chat-topbar-git'>
      <span aria-hidden='true' className='chat-topbar-git-icon'>⎇</span>
      <span className='chat-topbar-branch'>{branch}</span>
      {worktree && <span className='chat-topbar-worktree'>worktree</span>}
    </div>
  )
}
