import * as Select from '@radix-ui/react-select'
import { memo, type RefObject } from 'react'

/** Generic Radix-based select dropdown shared by all composer toolbar controls. */
export const ComposerSelect = memo(function ComposerSelect(
  {
    ariaLabel,
    disabled,
    onOpenChange,
    onValueChange,
    open,
    onOptionPointerMove,
    onOptionsPointerLeave,
    options,
    placeholder,
    triggerLabel,
    tone,
    triggerRef,
    loading,
    value,
  }: {
    ariaLabel: string
    disabled?: boolean
    onValueChange: (value: string) => void
    options: { description?: string; kind?: 'action'; label: string; value: string }[]
    placeholder?: string
    /** Secondary trigger label for controls whose values need a permanent name. */
    triggerLabel?: string
    tone:
      | 'agent'
      | 'behavior'
      | 'command'
      | 'improve'
      | 'model'
      | 'prompt'
      | 'response'
      | 'thinking'
    value: string
    loading?: boolean
    open?: boolean
    onOpenChange?: (open: boolean) => void
    onOptionPointerMove?: (value: string) => void
    onOptionsPointerLeave?: () => void
    triggerRef?: RefObject<HTMLButtonElement | null>
  },
) {
  return (
    <Select.Root
      disabled={disabled}
      onOpenChange={onOpenChange}
      open={open}
      onValueChange={onValueChange}
      value={value}
    >
      <Select.Trigger aria-label={ariaLabel} className={`composer-select ${tone}`} ref={triggerRef}>
        {loading
          ? <span aria-hidden='true' className='composer-select-spinner' />
          : <ComposerSelectIcon tone={tone} />}
        {triggerLabel
          ? (
            <span className='composer-select-trigger-copy'>
              <Select.Value placeholder={placeholder} />
              <small>{triggerLabel}</small>
            </span>
          )
          : <Select.Value placeholder={placeholder} />}
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className={`composer-select-content ${tone}`}
          position='popper'
          sideOffset={7}
        >
          <Select.Viewport onPointerLeave={onOptionsPointerLeave}>
            {options.map((option) => (
              <Select.Item
                className={`composer-select-option${option.kind === 'action' ? ' action' : ''}`}
                key={option.value}
                onPointerMove={() => onOptionPointerMove?.(option.value)}
                value={option.value}
              >
                <Select.ItemText>
                  <span className='composer-select-option-copy'>
                    <span>{option.label}</span>
                    {option.description && <small>{option.description}</small>}
                  </span>
                </Select.ItemText>
                <Select.ItemIndicator aria-hidden='true'>✓</Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
})

/** Uses consistent SVG pictograms independent of a font or emoji set. */
function ComposerSelectIcon(
  { tone }: {
    tone:
      | 'agent'
      | 'behavior'
      | 'command'
      | 'improve'
      | 'model'
      | 'prompt'
      | 'response'
      | 'thinking'
  },
) {
  if (tone === 'model')
    return (
      <svg aria-hidden='true' className='composer-select-icon' viewBox='0 0 16 16'>
        <path
          d='m2.5 5 5.5-2.5L13.5 5 8 7.5 2.5 5Zm0 3L8 10.5 13.5 8M2.5 11 8 13.5l5.5-2.5'
          fill='none'
          stroke='currentColor'
          strokeLinejoin='round'
          strokeWidth='1.4'
        />
      </svg>
    )
  if (tone === 'prompt')
    return (
      <svg aria-hidden='true' className='composer-select-icon' viewBox='0 0 16 16'>
        <path
          d='M3 2.5h10v11H3zM5.2 5.5h5.6M5.2 8h5.6M5.2 10.5h3.2'
          fill='none'
          stroke='currentColor'
          strokeLinecap='round'
          strokeLinejoin='round'
          strokeWidth='1.4'
        />
      </svg>
    )
  if (tone === 'response')
    return (
      <svg aria-hidden='true' className='composer-select-icon' viewBox='0 0 16 16'>
        <path
          d='M2.5 4.2h4.1m4.4 0h2.5M2.5 8h1.7m4.4 0h4.4M2.5 11.8h6.7m4.4 0h.4'
          fill='none'
          stroke='currentColor'
          strokeLinecap='round'
          strokeWidth='1.4'
        />
        <circle cx='8.5' cy='4.2' fill='none' r='1.5' stroke='currentColor' strokeWidth='1.2' />
        <circle cx='6' cy='8' fill='none' r='1.5' stroke='currentColor' strokeWidth='1.2' />
        <circle cx='10.7' cy='11.8' fill='none' r='1.5' stroke='currentColor' strokeWidth='1.2' />
      </svg>
    )
  if (tone === 'thinking')
    return (
      <svg aria-hidden='true' className='composer-select-icon' viewBox='0 0 16 16'>
        <path
          d='m8 2 1.4 4.6L14 8l-4.6 1.4L8 14 6.6 9.4 2 8l4.6-1.4L8 2Z'
          fill='none'
          stroke='currentColor'
          strokeLinejoin='round'
          strokeWidth='1.4'
        />
      </svg>
    )
  return <span className='composer-select-icon' aria-hidden='true' />
}
