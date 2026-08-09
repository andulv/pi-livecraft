import { memo } from 'react'
import type { SessionStats, SessionSummary } from '../../../../shared/types.ts'
import { formatSessionStats } from '../composer-utils.ts'
import { SessionInfo } from './SessionInfo.tsx'
import { SessionStats as SessionStatsBar } from './SessionStats.tsx'

export interface ChatTopBarGit {
  ahead: number
  branch: string
  changedFiles: number
  worktree: boolean
}

/** Two-line status strip separating repository context from session state. */
export const ChatTopBar = memo(function ChatTopBar(
  { session, running, compacting, stats, git, projectName, workspaceName }: {
    session: SessionSummary
    running: boolean
    compacting: boolean
    stats: SessionStats | null
    git: ChatTopBarGit | null
    projectName: string
    workspaceName: string
  },
) {
  const { cost, contextClass, contextTokens, contextPercent, contextPercentValue } =
    formatSessionStats(
      stats,
    )
  return (
    <div className='chat-topbar' aria-label='Workspace and session status'>
      <div className='chat-topbar-context'>
        <ContextItem label='Project' value={projectName} />
        <ContextItem label='Workspace' value={workspaceName} />
        {git && <GitContext git={git} />}
      </div>
      <div className='chat-topbar-session'>
        {compacting
          ? (
            <div aria-label='Compaction in progress' className='composer-compacting' role='status'>
              <span aria-hidden='true' className='composer-compacting-spinner' /> Compacting…
            </div>
          )
          : <SessionInfo name={session.name} cwd={session.cwd} active={running} />}
        <SessionStatsBar
          cost={cost}
          contextClass={contextClass}
          contextTokens={contextTokens}
          contextPercent={contextPercent}
          contextPercentValue={contextPercentValue}
        />
      </div>
    </div>
  )
})

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div className='chat-topbar-context-item'>
      <b>{label}</b>
      <span title={value}>{value}</span>
    </div>
  )
}

function GitContext({ git }: { git: ChatTopBarGit }) {
  const clean = git.changedFiles === 0
  return (
    <div className='chat-topbar-git'>
      <span aria-hidden='true' className='chat-topbar-git-icon'>⎇</span>
      <span className='chat-topbar-branch' title={git.branch}>{git.branch}</span>
      {git.worktree && <span className='chat-topbar-worktree'>worktree</span>}
      <span
        aria-label={clean ? 'Working tree clean' : `${git.changedFiles} changed files`}
        className={`chat-topbar-git-status ${clean ? 'clean' : 'changed'}`}
        title={clean ? 'Working tree clean' : `${git.changedFiles} changed files`}
      >
        <i aria-hidden='true' />
        {clean ? 'Clean' : (
          <>
            {git.changedFiles}
            <span className='chat-topbar-changed-label'>changed</span>
          </>
        )}
      </span>
      {git.ahead > 0 && <span className='chat-topbar-ahead'>↑{git.ahead}</span>}
    </div>
  )
}
