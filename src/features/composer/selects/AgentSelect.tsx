import { useEffect, useRef, memo, type RefObject } from 'react'
import { ComposerSelect } from './ComposerSelect.tsx'
import { capitalizeLabel } from '../composer-utils.ts'

/** Dropdown for choosing an agent from the list Pi exposes, with loading and busy states. */
export const AgentSelect = memo(function AgentSelect(
  {
    agentOptions,
    selectedAgent,
    agentLoading,
    agentBusy,
    onAgentChange,
    onRequestOptions,
    open,
    onOpenChange,
    triggerRef,
  }: {
    agentOptions: string[]
    selectedAgent: string
    agentLoading: boolean
    agentBusy: boolean
    onAgentChange: (agent: string) => void
    onRequestOptions?: () => void
    open: boolean
    onOpenChange: (open: boolean) => void
    triggerRef: RefObject<HTMLButtonElement | null>
  },
) {
  const pendingOpenRef = useRef(false)

  // Open the select when options arrive after a user-requested fetch.
  useEffect(() => {
    if (pendingOpenRef.current && agentOptions.length > 0 && !agentBusy) {
      pendingOpenRef.current = false
      onOpenChange(true)
    }
  }, [agentOptions.length, agentBusy, onOpenChange])

  return (
    <ComposerSelect
      ariaLabel='Agent'
      disabled={agentLoading || (agentBusy && agentOptions.length === 0)}
      onValueChange={onAgentChange}
      onOpenChange={(nextOpen) => {
        if (nextOpen && agentOptions.length === 0 && !agentBusy) {
          pendingOpenRef.current = true
          onRequestOptions?.()
          return
        }
        onOpenChange(nextOpen)
      }}
      open={open}
      options={selectedAgent && !agentOptions.includes(selectedAgent)
        ? [
          { label: capitalizeLabel(selectedAgent), value: selectedAgent },
          ...agentOptions.map((agent) => ({ label: capitalizeLabel(agent), value: agent })),
        ]
        : agentOptions.map((agent) => ({ label: capitalizeLabel(agent), value: agent }))}
      placeholder={agentLoading || (agentBusy && agentOptions.length === 0)
        ? 'Loading…'
        : 'Choose an agent'}
      tone='agent'
      triggerRef={triggerRef}
      value={selectedAgent}
    />
  )
})
