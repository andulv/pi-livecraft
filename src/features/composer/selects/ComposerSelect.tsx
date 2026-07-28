import * as Select from '@radix-ui/react-select'
import type { RefObject } from 'react'

/** Generic Radix-based select dropdown shared by all composer toolbar controls. */
export function ComposerSelect(
  {
    ariaLabel,
    disabled,
    onOpenChange,
    onValueChange,
    open,
    options,
    placeholder,
    tone,
    triggerRef,
    value,
  }: {
    ariaLabel: string
    disabled?: boolean
    onValueChange: (value: string) => void
    options: { label: string; value: string }[]
    placeholder?: string
    tone: 'agent' | 'behavior' | 'command' | 'improve' | 'model' | 'thinking'
    value: string
    open?: boolean
    onOpenChange?: (open: boolean) => void
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
        <ComposerSelectIcon tone={tone} />
        <Select.Value placeholder={placeholder} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className={`composer-select-content ${tone}`}
          position='popper'
          sideOffset={7}
        >
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                className='composer-select-option'
                key={option.value}
                value={option.value}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator aria-hidden='true'>✓</Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

/** Uses consistent SVG pictograms independent of a font or emoji set. */
function ComposerSelectIcon(
  { tone }: { tone: 'agent' | 'behavior' | 'command' | 'improve' | 'model' | 'thinking' },
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
