import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import type { JsonObject } from '../../../../shared/types.ts'
import { usePinnedModels } from './model-favorites.ts'
import {
  groupModelOptions,
  modelCostLabel,
  providerDisplayName,
  toModelOption,
  type ModelOption,
} from './model-select-utils.ts'

const POPOVER_HEIGHT = 360

/** Selects the active LLM model from Pi's available models, issuing a set_model command on change. */
export const ModelSelect = memo(function ModelSelect(
  { models, currentModel, onCommand, onError, open, onOpenChange, triggerRef }: {
    models: JsonObject[]
    currentModel: string
    onCommand: (command: JsonObject) => Promise<JsonObject>
    onError: (cause: unknown) => void
    open: boolean
    onOpenChange: (open: boolean) => void
    triggerRef: RefObject<HTMLButtonElement | null>
  },
) {
  const [pinned, togglePin] = usePinnedModels()
  const [highlight, setHighlight] = useState(0)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )

  const options = models.map(toModelOption).filter((option): option is ModelOption =>
    option !== undefined
  )
  const groups = groupModelOptions(options, pinned)
  const flat: ModelOption[] = []
  const flatIndex = new Map<string, number>()
  for (const group of groups) {
    for (const model of group.models) {
      flatIndex.set(model.key, flat.length)
      flat.push(model)
    }
  }
  const selected = options.find((option) => option.key === currentModel)

  // Reset the highlight to the active model each time the menu opens.
  // oxlint-disable react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) setHighlight(flatIndex.get(currentModel) ?? 0)
  }, [open])

  // Anchor the popover to the trigger, flipping above when space below is tight.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const trigger = triggerRef.current
    if (!trigger) return
    const place = () => {
      const rect = trigger.getBoundingClientRect()
      const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 24)
      const below = rect.bottom + 7
      const openBelow = below + POPOVER_HEIGHT <= window.innerHeight || rect.top < POPOVER_HEIGHT
      setPosition({
        top: openBelow ? below : Math.max(8, rect.top - 7 - POPOVER_HEIGHT),
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
  }, [open, triggerRef])

  // Close on outside pointer interaction; the trigger toggles via its own click handler.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onOpenChange, triggerRef])

  // Keep the highlighted row scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open) return
    popoverRef
      .current
      ?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const selectModel = useCallback(
    (option: ModelOption) => {
      onOpenChange(false)
      void onCommand({ type: 'set_model', provider: option.provider, modelId: option.id })
        .catch(onError)
    },
    [onCommand, onError, onOpenChange],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!open || flat.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlight((index) => (index + 1) % flat.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlight((index) => (index - 1 + flat.length) % flat.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const target = flat[highlight]
        if (target) selectModel(target)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
      }
    },
    [flat, highlight, open, selectModel, onOpenChange],
  )

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup='listbox'
        aria-label='Model'
        className={`composer-select model${open ? ' open' : ''}`}
        onClick={() => onOpenChange(!open)}
        onKeyDown={onKeyDown}
        ref={triggerRef}
        type='button'
      >
        <svg aria-hidden='true' className='composer-select-icon' viewBox='0 0 16 16'>
          <path
            d='m2.5 5 5.5-2.5L13.5 5 8 7.5 2.5 5Zm0 3L8 10.5 13.5 8M2.5 11 8 13.5l5.5-2.5'
            fill='none'
            stroke='currentColor'
            strokeLinejoin='round'
            strokeWidth='1.4'
          />
        </svg>
        <span className='composer-select-value'>
          {selected
            ? (
              <>
                <small className='composer-select-provider'>
                  {providerDisplayName(selected.provider)}
                </small>
                {selected.name}
              </>
            )
            : 'Choose a model'}
        </span>
      </button>
      {open && position && createPortal(
        <div
          className='model-menu'
          ref={popoverRef}
          role='listbox'
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${position.width}px`,
          }}
        >
          {flat.length === 0
            ? <p className='model-menu-empty'>No models available.</p>
            : groups.map((group) => (
              <div
                aria-label={group.label}
                className='model-menu-group'
                key={group.key}
                role='group'
              >
                <div className='model-menu-group-label'>{group.label}</div>
                {group.models.map((option) => {
                  const index = flatIndex.get(option.key) ?? 0
                  const isPinned = pinned.has(option.key)
                  return (
                    <div
                      aria-selected={index === highlight}
                      className={`model-menu-item${index === highlight ? ' highlighted' : ''}${
                        option.key === currentModel ? ' current' : ''
                      }`}
                      data-index={index}
                      key={option.key}
                      onClick={() => selectModel(option)}
                      role='option'
                    >
                      <span className='model-menu-item-copy'>
                        <span className='model-menu-name'>{option.name}</span>
                        <ModelMeta option={option} />
                      </span>
                      <button
                        aria-label={isPinned ? `Unpin ${option.name}` : `Pin ${option.name}`}
                        aria-pressed={isPinned}
                        className={`model-menu-star${isPinned ? ' pinned' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          togglePin(option.key)
                          triggerRef.current?.focus()
                        }}
                        type='button'
                      >
                        ★
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
        </div>,
        document.body,
      )}
    </>
  )
})

function ModelMeta({ option }: { option: ModelOption }) {
  const label = modelCostLabel(option)
  if (label === null) return null
  if (label.kind === 'subscription') {
    return <span className='model-menu-sub'>Subscription</span>
  }
  if (label.kind === 'covered') {
    return (
      <span className='model-menu-covered'>
        <small aria-hidden='true' className='model-menu-cost'>{label.text}</small>
        <span className='model-menu-sub'>Plan</span>
      </span>
    )
  }
  return <small className='model-menu-cost'>{label.text}</small>
}
