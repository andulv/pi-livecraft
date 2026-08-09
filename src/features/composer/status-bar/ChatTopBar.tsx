import { memo } from 'react'
import type { SessionStats, SessionSummary } from '../../../../shared/types.ts'
import { formatSessionStats } from '../composer-utils.ts'
import { SessionInfo } from './SessionInfo.tsx'
import { SessionStats as SessionStatsBar } from './SessionStats.tsx'

export interface ChatTopBarGit {
  ahead: number
  baseAhead: number
  baseBehind: number
  baseBranch: string | null
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
  const formattedStats = formatSessionStats(stats)
  return (
    <div className='chat-topbar' aria-label='Workspace and session status'>
      <div className='chat-topbar-context'>
        <ContextItem label='Project' value={projectName} />
        <ContextItem detail={session.cwd} label='Workspace' value={workspaceName} />
        {git && <GitContext git={git} />}
      </div>
      <div className='chat-topbar-session'>
        {compacting
          ? (
            <div aria-label='Compaction in progress' className='composer-compacting' role='status'>
              <span aria-hidden='true' className='composer-compacting-spinner' /> Compacting…
            </div>
          )
          : <SessionInfo name={session.name} active={running} />}
        <SessionStatsBar {...formattedStats} />
      </div>
    </div>
  )
})

function ContextItem(
  { detail, label, value }: { detail?: string; label: string; value: string },
) {
  return (
    <div className={`chat-topbar-context-item${detail ? ' workspace' : ''}`}>
      <b>{label}</b>
      <span className='chat-topbar-context-value' title={value}>{value}</span>
      {detail && <span className='chat-topbar-context-detail' title={detail}>{detail}</span>}
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
      {git.worktree && git.baseBranch && <WorktreeDivergence git={git} />}
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
      {git.ahead > 0 && (
        <span
          aria-label={`${git.ahead} unpushed commits`}
          className='chat-topbar-ahead'
          title={`${git.ahead} unpushed commits`}
        >
          <span className='chat-topbar-unpushed-label'>Push</span> ↑{git.ahead}
        </span>
      )}
    </div>
  )
}

function WorktreeDivergence({ git }: { git: ChatTopBarGit }) {
  const baseBranch = git.baseBranch ?? ''
  const description = `${git.baseAhead} commits ahead of ${baseBranch}, ${git.baseBehind} behind`
  return (
    <span aria-label={description} className='chat-topbar-divergence' title={description}>
      <b>vs {baseBranch}</b>
      <span className='ahead'>+{git.baseAhead}</span>
      <span className='behind'>−{git.baseBehind}</span>
    </span>
  )
}
