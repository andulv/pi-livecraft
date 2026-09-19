import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

const OPTION_HEIGHT = 34

type ComposerSelectOption = {
  description?: string
  disabled?: boolean
  kind?: 'action'
  label: string
  value: string
}

/** Lightweight non-modal select menu shared by the composer toolbar controls. */
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
    options: ComposerSelectOption[]
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
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isOpen = open ?? uncontrolledOpen
  const localTriggerRef = useRef<HTMLButtonElement>(null)
  const resolvedTriggerRef = triggerRef ?? localTriggerRef
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const [highlightIndex, setHighlightIndex] = useState(selectedIndex)
  const hasDescriptions = options.some((option) => Boolean(option.description))
  const estimatedHeight = Math.min(
    options.reduce((height, option) => height + (option.description ? 48 : OPTION_HEIGHT), 2),
    320,
  )
  const selectedOption = options.find((option) => option.value === value)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )

  const setOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange, open])

  // Start keyboard navigation at the current value whenever a menu opens.
  useEffect(() => {
    if (isOpen) setHighlightIndex(selectedIndex)
  }, [isOpen, selectedIndex])

  // Anchor the menu to the trigger, flipping above when space below is tight.
  useLayoutEffect(() => {
    if (!isOpen) return
    const trigger = resolvedTriggerRef.current
    if (!trigger) return
    const place = () => {
      const rect = trigger.getBoundingClientRect()
      const width = Math.min(
        Math.max(rect.width, hasDescriptions ? 220 : 112),
        window.innerWidth - 24,
      )
      const below = rect.bottom + 7
      const openBelow = below + estimatedHeight <= window.innerHeight || rect.top < estimatedHeight
      const nextPosition = {
        top: openBelow ? below : Math.max(8, rect.top - 7 - estimatedHeight),
        left: Math.min(Math.max(12, rect.left), window.innerWidth - width - 12),
        width,
      }
      setPosition((current) =>
        current && current.top === nextPosition.top && current.left === nextPosition.left
          && current.width === nextPosition.width
          ? current
          : nextPosition
      )
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [estimatedHeight, hasDescriptions, isOpen, resolvedTriggerRef])

  useEffect(() => {
    if (isOpen) return
    setPosition(null)
  }, [isOpen])

  // Close when a pointer or focus moves outside the trigger and menu.
  useEffect(() => {
    if (!isOpen) return
    const isInside = (target: EventTarget | null) =>
      target instanceof Node
      && (resolvedTriggerRef.current?.contains(target) === true
        || menuRef.current?.contains(target) === true)
    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) setOpen(false)
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!isInside(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [isOpen, resolvedTriggerRef, setOpen])

  const selectOption = useCallback((option: ComposerSelectOption) => {
    if (option.disabled) return
    setOpen(false)
    onValueChange(option.value)
  }, [onValueChange, setOpen])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlightIndex(selectedIndex)
        setOpen(true)
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (options.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setHighlightIndex((index) => {
        for (let step = 1; step <= options.length; step += 1) {
          const nextIndex = (index + direction * step + options.length) % options.length
          if (!options[nextIndex]?.disabled) return nextIndex
        }
        return index
      })
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const enabled = options.filter((option) => !option.disabled)
      const target = event.key === 'Home' ? enabled[0] : enabled.at(-1)
      if (target) setHighlightIndex(options.indexOf(target))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = options[highlightIndex]
      if (option) selectOption(option)
    }
  }, [highlightIndex, isOpen, options, selectOption, selectedIndex, setOpen])

  return (
    <>
      <button
        aria-activedescendant={isOpen && options[highlightIndex]
          ? `${menuId}-${highlightIndex}`
          : undefined}
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        aria-haspopup='listbox'
        aria-label={ariaLabel}
        className={`composer-select ${tone}`}
        role='combobox'
        data-state={isOpen ? 'open' : 'closed'}
        disabled={disabled}
        onClick={() => setOpen(!isOpen)}
        onKeyDown={onKeyDown}
        ref={resolvedTriggerRef}
        type='button'
      >
        {loading
          ? <span aria-hidden='true' className='composer-select-spinner' />
          : <ComposerSelectIcon tone={tone} />}
        {triggerLabel
          ? (
            <span className='composer-select-trigger-copy'>
              <span className='composer-select-value'>{selectedOption?.label ?? placeholder}</span>
              <small>{triggerLabel}</small>
            </span>
          )
          : <span className='composer-select-value'>{selectedOption?.label ?? placeholder}</span>}
      </button>
      {isOpen && position && createPortal(
        <div
          aria-label={ariaLabel}
          className={`composer-select-content ${tone} composer-select-menu`}
          id={menuId}
          onPointerLeave={onOptionsPointerLeave}
          ref={menuRef}
          role='listbox'
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${position.width}px`,
          }}
        >
          {options.map((option, index) => (
            <div
              aria-disabled={option.disabled || undefined}
              aria-selected={option.value === value}
              className={`composer-select-option${option.kind === 'action' ? ' action' : ''}`}
              data-disabled={option.disabled || undefined}
              data-highlighted={index === highlightIndex ? '' : undefined}
              data-state={option.value === value ? 'checked' : 'unchecked'}
              id={`${menuId}-${index}`}
              key={option.value}
              onClick={() => selectOption(option)}
              onPointerMove={() => {
                setHighlightIndex(index)
                onOptionPointerMove?.(option.value)
              }}
              role='option'
            >
              <span className='composer-select-option-copy'>
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </span>
              {option.value === value && <span aria-hidden='true'>✓</span>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
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
