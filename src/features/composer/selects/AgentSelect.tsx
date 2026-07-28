import type { RefObject } from 'react'
import { ComposerSelect } from './ComposerSelect.tsx'
import { capitalizeLabel } from '../composer-utils.ts'

/** Dropdown for choosing an agent from the list Pi exposes, with loading and busy states. */
export function AgentSelect(
  {
    agentOptions,
    selectedAgent,
    agentLoading,
    agentBusy,
    onAgentChange,
    open,
    onOpenChange,
    triggerRef,
  }: {
    agentOptions: string[]
    selectedAgent: string
    agentLoading: boolean
    agentBusy: boolean
    onAgentChange: (agent: string) => void
    open: boolean
    onOpenChange: (open: boolean) => void
    triggerRef: RefObject<HTMLButtonElement | null>
  },
) {
  return (
    <ComposerSelect
      ariaLabel='Agent'
      disabled={agentLoading || agentBusy || agentOptions.length === 0}
      onValueChange={onAgentChange}
      onOpenChange={onOpenChange}
      open={open}
      options={agentOptions.map((agent) => ({ label: capitalizeLabel(agent), value: agent }))}
      placeholder={agentLoading || agentBusy ? 'Loading…' : 'Choose an agent'}
      tone='agent'
      triggerRef={triggerRef}
      value={selectedAgent}
    />
  )
}
