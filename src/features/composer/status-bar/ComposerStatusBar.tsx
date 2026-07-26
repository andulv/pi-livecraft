import type { SessionSummary } from '../../../../shared/types.ts'
import { SessionInfo } from './SessionInfo.tsx'
import { SessionStats } from './SessionStats.tsx'

export function ComposerStatusBar({ session, running, cost, contextClass, contextTokens, contextPercent, contextPercentValue }: {
  session: SessionSummary
  running: boolean
  cost: string
  contextClass: string
  contextTokens: string
  contextPercent: string
  contextPercentValue: number | null
}) {
  return (
    <div className="composer-info" aria-label="Session information">
      <SessionInfo name={session.name} cwd={session.cwd} active={running} />
      <SessionStats cost={cost} contextClass={contextClass} contextTokens={contextTokens} contextPercent={contextPercent} contextPercentValue={contextPercentValue} />
    </div>
  )
}
