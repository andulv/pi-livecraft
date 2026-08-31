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
  buildListPriceIndex,
  FAVORITES_GROUP_KEY,
  filterModelGroups,
  groupModelOptions,
  modelCostLabel,
  providerDisplayName,
  toModelOption,
  type ListPriceIndex,
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
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Collapsed groups stay collapsed for the app session; favorites start expanded.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() =>
    new Set([FAVORITES_GROUP_KEY])
  )
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )

  const options = models.map(toModelOption).filter((option): option is ModelOption =>
    option !== undefined
  )
  const listPrices = buildListPriceIndex(options)
  const groups = groupModelOptions(options, pinned)
  const filtering = query.trim().length > 0
  const visibleGroups = filtering ? filterModelGroups(groups, query) : groups
  // Only rows the user can see (expanded groups, filter matches) take part in selection.
  const flat: ModelOption[] = []
  const flatIndex = new Map<string, number>()
  for (const group of visibleGroups) {
    if (!filtering && !expandedGroups.has(group.key)) continue
    for (const model of group.models) {
      flatIndex.set(model.key, flat.length)
      flat.push(model)
    }
  }
  const highlightIndex = highlightKey === null ? -1 : flatIndex.get(highlightKey) ?? -1
  const selected = options.find((option) => option.key === currentModel)

  // On open, highlight the active model when visible; on close, reset the filter
  // so the next open shows every group again.
  // oxlint-disable react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) {
      setHighlightKey(
        flat.some((model) => model.key === currentModel) ? currentModel : flat[0]?.key ?? null,
      )
    } else {
      setQuery('')
    }
  }, [open])

  // Follow the visible rows whenever the filtered list changes under the highlight.
  useEffect(() => {
    if (!open) return
    if (highlightKey !== null && !flatIndex.has(highlightKey)) {
      setHighlightKey(flat[0]?.key ?? null)
    }
  }, [query, pinned])

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
    if (!open || highlightKey === null) return
    const index = flatIndex.get(highlightKey)
    if (index === undefined) return
    popoverRef
      .current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlightKey, open, query, pinned])

  const selectModel = useCallback(
    (option: ModelOption) => {
      onOpenChange(false)
      void onCommand({ type: 'set_model', provider: option.provider, modelId: option.id })
        .catch(onError)
    },
    [onCommand, onError, onOpenChange],
  )

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Shared by the trigger and the filter input, both of which can hold focus while open.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!open || flat.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlightKey(flat[(highlightIndex + 1) % flat.length].key)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlightKey(flat[(highlightIndex - 1 + flat.length) % flat.length].key)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const target = flat[highlightIndex]
        if (target) selectModel(target)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
      }
    },
    [flat, highlightIndex, open, selectModel, onOpenChange],
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
          <div className='model-menu-search'>
            <label className='model-menu-search-field'>
              <svg aria-hidden='true' className='model-menu-search-icon' viewBox='0 0 16 16'>
                <circle
                  cx='7'
                  cy='7'
                  r='4.2'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='1.4'
                />
                <path
                  d='m10.2 10.2 3.3 3.3'
                  fill='none'
                  stroke='currentColor'
                  strokeLinecap='round'
                  strokeWidth='1.4'
                />
              </svg>
              <input
                aria-label='Filter models'
                autoComplete='off'
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder='Search models…'
                ref={searchRef}
                spellCheck={false}
                type='text'
                value={query}
              />
              {query !== '' && (
                <button
                  aria-label='Clear filter'
                  className='model-menu-search-clear'
                  onClick={() => {
                    setQuery('')
                    searchRef.current?.focus()
                  }}
                  type='button'
                >
                  ×
                </button>
              )}
            </label>
          </div>
          <div className='model-menu-list'>
            {flat.length === 0
              ? (
                <p className='model-menu-empty'>
                  {filtering ? `No models match “${query.trim()}”.` : 'No models available.'}
                </p>
              )
              : visibleGroups.map((group) => {
                const isOpen = filtering || expandedGroups.has(group.key)
                return (
                  <div
                    aria-label={group.label}
                    className='model-menu-group'
                    key={group.key}
                    role='group'
                  >
                    {filtering
                      ? (
                        <div className='model-menu-group-label'>
                          <span className='model-menu-group-name'>{group.label}</span>
                          <span className='model-menu-group-count'>{group.models.length}</span>
                        </div>
                      )
                      : (
                        <button
                          aria-expanded={isOpen}
                          className='model-menu-group-header'
                          onClick={() => toggleGroup(group.key)}
                          type='button'
                        >
                          <svg
                            aria-hidden='true'
                            className='model-menu-chevron'
                            viewBox='0 0 16 16'
                          >
                            <path
                              d='m6 4 4 4-4 4'
                              fill='none'
                              stroke='currentColor'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='1.6'
                            />
                          </svg>
                          <span className='model-menu-group-name'>{group.label}</span>
                          <span className='model-menu-group-count'>{group.models.length}</span>
                        </button>
                      )}
                    {isOpen && group.models.map((option) => {
                      const index = flatIndex.get(option.key) ?? 0
                      const isHighlighted = option.key === highlightKey
                      const isPinned = pinned.has(option.key)
                      return (
                        <div
                          aria-selected={isHighlighted}
                          className={`model-menu-item${isHighlighted ? ' highlighted' : ''}${
                            option.key === currentModel ? ' current' : ''
                          }`}
                          data-index={index}
                          key={option.key}
                          onClick={() => selectModel(option)}
                          role='option'
                        >
                          <span className='model-menu-item-copy'>
                            <span className='model-menu-name'>{option.name}</span>
                            <ModelMeta listPrices={listPrices} option={option} />
                          </span>
                          <button
                            aria-label={isPinned ? `Unpin ${option.name}` : `Pin ${option.name}`}
                            aria-pressed={isPinned}
                            className={`model-menu-star${isPinned ? ' pinned' : ''}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              // Pinning moves the row to another group; expand the
                              // destination so the starred model stays in view.
                              setExpandedGroups((prev) => {
                                const next = new Set(prev)
                                next.add(isPinned ? option.provider : FAVORITES_GROUP_KEY)
                                return next
                              })
                              togglePin(option.key)
                              searchRef.current?.focus()
                            }}
                            type='button'
                          >
                            ★
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
})

function ModelMeta({ listPrices, option }: { listPrices: ListPriceIndex; option: ModelOption }) {
  const label = modelCostLabel(option, listPrices)
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
