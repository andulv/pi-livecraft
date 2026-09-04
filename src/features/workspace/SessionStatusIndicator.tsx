import { useEffect, useState } from 'react'
import { CompactingIcon } from '../../components/CompactingIcon.tsx'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { SessionIndicator } from './session-indicator.ts'

const indicatorLabels: Record<SessionIndicator, string> = {
  working: 'Pi is working',
  waiting: 'Pi is waiting for your response',
  compacting: 'Pi is compacting the session',
  complete: 'Pi finished its turn',
  idle: 'Pi is idle',
}

const workingPulseIntervalMs = 1_000
const workingPulseListeners = new Set<(large: boolean) => void>()
let workingPulseLarge = false
let workingPulseTimer: number | undefined

/** Shares one discrete size pulse across working indicators instead of continuous CSS animation. */
function useWorkingPulse(working: boolean): boolean {
  const [large, setLarge] = useState(false)
  useEffect(() => {
    if (working === false || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLarge(false)
      return
    }
    workingPulseListeners.add(setLarge)
    setLarge(workingPulseLarge)
    if (workingPulseTimer === undefined) {
      workingPulseTimer = window.setInterval(() => {
        workingPulseLarge = !workingPulseLarge
        for (const listener of workingPulseListeners) listener(workingPulseLarge)
      }, workingPulseIntervalMs)
    }
    return () => {
      workingPulseListeners.delete(setLarge)
      if (workingPulseListeners.size === 0 && workingPulseTimer !== undefined) {
        window.clearInterval(workingPulseTimer)
        workingPulseTimer = undefined
        workingPulseLarge = false
      }
    }
  }, [working])
  return large
}

/** Reusable indicator using the same visual vocabulary as the workspace sidebar. */
export function SessionStatusIndicator({ status }: { status: SessionIndicator }) {
  const pulseLarge = useWorkingPulse(status === 'working')
  return (
    <Tooltip label={indicatorLabels[status]}>
      <span
        aria-label={indicatorLabels[status]}
        className={`session-status-indicator ${status}${
          pulseLarge && status === 'working' ? ' working-pulse-large' : ''
        }`}
        role='img'
      >
        {status === 'compacting' && <CompactingIcon />}
        {status === 'waiting' && <WaitingIcon />}
        {status === 'complete' && <CompleteIcon />}
      </span>
    </Tooltip>
  )
}

/** Filled chat-bubble icon for the waiting-for-response indicator. */
function WaitingIcon() {
  return (
    <svg aria-hidden='true' fill='currentColor' height='14' viewBox='0 0 24 24' width='14'>
      <path d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z' />
    </svg>
  )
}

/** Simple checkmark for completed sessions. */
function CompleteIcon() {
  return (
    <svg aria-hidden='true' fill='currentColor' height='14' viewBox='0 0 24 24' width='14'>
      <path
        d='M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='.6'
      />
    </svg>
  )
}
