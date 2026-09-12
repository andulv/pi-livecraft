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
import type { JsonObject } from '../../../../shared/types.ts'
import { capitalizeLabel } from '../composer-utils.ts'

/** Levels used until a snapshot reports the model's supported thinking levels. */
const fallbackThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const OPTION_HEIGHT = 34

/** Selects the thinking effort level sent to Pi, from off to max. */
export const ThinkingSelect = memo(
  function ThinkingSelect(
    { thinking, levels, onCommand, onError, open, onOpenChange, triggerRef }: {
      thinking: string
      levels: string[]
      onCommand: (command: JsonObject) => Promise<JsonObject>
      onError: (cause: unknown) => void
      open: boolean
      onOpenChange: (open: boolean) => void
      triggerRef: RefObject<HTMLButtonElement | null>
    },
  ) {
    const supportedLevels = levels.length > 0 ? levels : fallbackThinkingLevels
    const selectedIndex = Math.max(0, supportedLevels.indexOf(thinking))
    const [highlightIndex, setHighlightIndex] = useState(selectedIndex)
    const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
      null,
    )
    const menuRef = useRef<HTMLDivElement>(null)
    const menuId = useId()

    useEffect(() => {
      if (open) setHighlightIndex(selectedIndex)
    }, [open, selectedIndex])

    useLayoutEffect(() => {
      if (!open) {
        setPosition(null)
        return
      }
      const trigger = triggerRef.current
      if (!trigger) return
      const place = () => {
        const rect = trigger.getBoundingClientRect()
        const width = Math.min(Math.max(rect.width, 112), window.innerWidth - 24)
        const height = Math.min(supportedLevels.length * OPTION_HEIGHT + 2, 320)
        const below = rect.bottom + 7
        const openBelow = below + height <= window.innerHeight || rect.top < height
        setPosition({
          top: openBelow ? below : Math.max(8, rect.top - 7 - height),
          left: Math.min(Math.max(12, rect.left), window.innerWidth - width - 12),
          width,
        })
      }
      place()
      window.addEventListener('scroll', place, true)
      window.addEventListener('resize', place)
      return () => {
        window.removeEventListener('scroll', place, true)
        window.removeEventListener('resize', place)
      }
    }, [open, supportedLevels.length, triggerRef])

    useEffect(() => {
      if (!open) return
      const onPointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null
        if (!target) return
        if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
        onOpenChange(false)
      }
      document.addEventListener('pointerdown', onPointerDown)
      return () => document.removeEventListener('pointerdown', onPointerDown)
    }, [open, onOpenChange, triggerRef])

    const selectLevel = useCallback((level: string) => {
      onOpenChange(false)
      void onCommand({ type: 'set_thinking_level', level }).catch(onError)
    }, [onCommand, onError, onOpenChange])

    const onKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
      if (!open) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          onOpenChange(true)
        }
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlightIndex((index) => (index + 1) % supportedLevels.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlightIndex((index) => (index - 1 + supportedLevels.length) % supportedLevels.length)
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const level = supportedLevels[highlightIndex]
        if (level) selectLevel(level)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
      }
    }, [highlightIndex, onOpenChange, open, selectLevel, supportedLevels])

    return (
      <>
        <button
          aria-activedescendant={open ? `${menuId}-${highlightIndex}` : undefined}
          aria-controls={open ? menuId : undefined}
          aria-expanded={open}
          aria-haspopup='listbox'
          aria-label='Thinking level'
          className='composer-select thinking'
          data-state={open ? 'open' : 'closed'}
          onClick={() => onOpenChange(!open)}
          onKeyDown={onKeyDown}
          ref={triggerRef}
          type='button'
        >
          <svg aria-hidden='true' className='composer-select-icon' viewBox='0 0 16 16'>
            <path
              d='m8 2 1.4 4.6L14 8l-4.6 1.4L8 14 6.6 9.4 2 8l4.6-1.4L8 2Z'
              fill='none'
              stroke='currentColor'
              strokeLinejoin='round'
              strokeWidth='1.4'
            />
          </svg>
          <span>{capitalizeLabel(thinking)}</span>
        </button>
        {open && position && createPortal(
          <div
            aria-label='Thinking level'
            className='composer-select-content thinking thinking-menu'
            id={menuId}
            ref={menuRef}
            role='listbox'
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
              width: `${position.width}px`,
            }}
          >
            {supportedLevels.map((level, index) => (
              <div
                aria-selected={level === thinking}
                className='composer-select-option'
                data-highlighted={index === highlightIndex ? '' : undefined}
                data-state={level === thinking ? 'checked' : 'unchecked'}
                id={`${menuId}-${index}`}
                key={level}
                onClick={() => selectLevel(level)}
                onPointerMove={() => setHighlightIndex(index)}
                role='option'
              >
                <span>{capitalizeLabel(level)}</span>
                {level === thinking && <span aria-hidden='true'>✓</span>}
              </div>
            ))}
          </div>,
          document.body,
        )}
      </>
    )
  },
)
