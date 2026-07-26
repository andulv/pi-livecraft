import { memo, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type FormEvent } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { JsonObject, SessionSnapshot, SessionSummary } from '../../../shared/types.ts'
import { maxComposerImages, prepareComposerImage, type ComposerImage } from './composer-images.ts'
import { ensureCompactCommand, formatTokens, isCompactCommandDraft, isObject, readComposerDraft } from './composer-utils.ts'
import { AgentSelect } from './selects/AgentSelect.tsx'
import { BehaviorSelect } from './selects/BehaviorSelect.tsx'
import { ModelSelect } from './selects/ModelSelect.tsx'
import { ThinkingSelect } from './selects/ThinkingSelect.tsx'
import { ComposerStatusBar } from './status-bar/ComposerStatusBar.tsx'

/** Provides user input and session commands while reflecting the current Pi state. */
export const Composer = memo(function Composer({ session, snapshot, agentBusy, agentOptions, selectedAgent, agentLoading, showAgentSelector, onAgentChange, onCommand, commands, running, compacting, onSend, onAbort, onImprovePrompt, onError, requestedSelect, onSelectOpened, submitRequest = 0, focusRequest, draftRequest, onDraftApplied }: {
  session: SessionSummary
  snapshot: SessionSnapshot
  agentBusy: boolean
  agentOptions: string[]
  selectedAgent: string
  agentLoading: boolean
  showAgentSelector: boolean
  onAgentChange: (agent: string) => void
  onCommand: (command: JsonObject) => Promise<JsonObject>
  commands: JsonObject[]
  running: boolean
  compacting: boolean
  onSend: (message: string, images: JsonObject[], behavior: 'steer' | 'followUp') => Promise<void>
  onAbort: () => Promise<JsonObject>
  onImprovePrompt: (prompt: string) => Promise<{ prompt: string; cost?: number }>
  onError: (cause: unknown) => void
  requestedSelect?: 'agent' | 'model' | 'thinking' | null
  onSelectOpened?: () => void
  submitRequest?: number
  focusRequest?: number
  draftRequest?: { id: string; message: string }
  onDraftApplied?: (id: string) => void
}) {
  const draftStorageKey = `pi-livecraft.composer-draft.${session.id}`
  const [message, setMessage] = useState(() => readComposerDraft(draftStorageKey))
  const [images, setImages] = useState<ComposerImage[]>([])
  const [preparingImages, setPreparingImages] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [improving, setImproving] = useState(false)
  const [suggestion, setSuggestion] = useState<{ original: string; improved: string; cost?: number }>()
  const [openSelect, setOpenSelect] = useState<'agent' | 'model' | 'thinking' | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const agentTriggerRef = useRef<HTMLButtonElement>(null)
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const thinkingTriggerRef = useRef<HTMLButtonElement>(null)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashIndex, setSlashIndex] = useState(-1)
  const [behavior, setBehavior] = useState<'steer' | 'followUp'>('steer')
  const model = isObject(snapshot.state?.model) ? snapshot.state.model : null
  const currentModel = model && typeof model.id === 'string' && typeof model.provider === 'string' ? `${model.provider}/${model.id}` : ''
  const selectedModel = snapshot.models.find((item) => `${item.provider}/${item.id}` === currentModel)
  const modelInput = selectedModel?.input ?? model?.input
  const supportsImages = Array.isArray(modelInput) && modelInput.includes('image')
  const thinking = typeof snapshot.state?.thinkingLevel === 'string' ? snapshot.state.thinkingLevel : 'off'
  /** Snapshot commands augmented with the local compact command when Pi doesn't expose it. */
  const allCommands = ensureCompactCommand(commands)
  const pendingCommandName = /^\/([^\s]+)/.exec(message)?.[1].toLowerCase()
  const commandPending = pendingCommandName !== undefined && allCommands.some((command) => String(command.name).toLowerCase() === pendingCommandName)

  useEffect(() => {
    if (submitRequest > 0) formRef.current?.requestSubmit()
  }, [submitRequest])

  // oxlint-disable react-hooks/exhaustive-deps
  useEffect(() => {
    if ((focusRequest ?? 0) > 0) textareaRef.current?.focus()
  }, [focusRequest])

  useEffect(() => {
    if (!requestedSelect) return
    setOpenSelect(requestedSelect)
    const trigger = requestedSelect === 'agent' ? agentTriggerRef.current : requestedSelect === 'model' ? modelTriggerRef.current : thinkingTriggerRef.current
    trigger?.focus()
    onSelectOpened?.()
  }, [onSelectOpened, requestedSelect])

  useEffect(() => {
    if (!draftRequest) return
    setDraftMessage(draftRequest.message)
    textareaRef.current?.focus()
    onDraftApplied?.(draftRequest.id)
  }, [draftRequest, onDraftApplied])

  /** Available commands filtered by the text after the slash. */
  const filteredCommands = allCommands.filter((command) =>
    slashOpen && String(command.name).toLowerCase().includes(slashFilter.toLowerCase()),
  )

  /** Inserts the selected slash command into the textarea and closes the popover. */
  function selectSlashCommand(name: string): void {
    setDraftMessage(`/${name} `)
    setSlashOpen(false)
    setSlashIndex(-1)
  }

  /** Updates the visible draft and persists it so a page reload cannot discard typed text. */
  function setDraftMessage(nextMessage: string): void {
    setMessage(nextMessage)
    try {
      if (nextMessage) window.localStorage.setItem(draftStorageKey, nextMessage)
      else window.localStorage.removeItem(draftStorageKey)
    } catch {
      // Storage can be unavailable in private browsing; the in-memory draft still works.
    }
  }

  /** Sends text and images in the same RPC command, restoring the draft on failure. */
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const nextMessage = message.trim()
    if (preparingImages || (!nextMessage && images.length === 0)) return
    if (images.length > 0 && !supportsImages) {
      onError('The selected model does not accept images.')
      return
    }
    setSubmitting(true)
    setSuggestion(undefined)
    setDraftMessage('')
    setImages([])
    try {
      if (isCompactCommandDraft(nextMessage)) {
        await onCommand({ type: 'compact' })
        return
      }
      await onSend(nextMessage, images.map(({ data, mimeType }) => ({ type: 'image', data, mimeType })), behavior)
    } catch (cause) {
      setDraftMessage(nextMessage)
      setImages(images)
      onError(cause)
    } finally {
      setSubmitting(false)
    }
  }

  /** Produces an isolated rewrite while preserving the source text for an explicit comparison. */
  async function improveDraft(): Promise<void> {
    const original = message.trim()
    if (!original || improving) return
    setImproving(true)
    setSuggestion(undefined)
    try {
      const result = await onImprovePrompt(original)
      setSuggestion({ original, improved: result.prompt, cost: result.cost })
    } catch (cause) {
      onError(cause)
    } finally {
      setImproving(false)
    }
  }

  /** Prepares pasted images locally to bound the HTTP body and context sent to the model. */
  async function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0 || submitting) return
    event.preventDefault()
    const pastedText = event.clipboardData.getData('text/plain')
    const { selectionEnd, selectionStart } = event.currentTarget
    if (pastedText) setDraftMessage(`${message.slice(0, selectionStart)}${pastedText}${message.slice(selectionEnd)}`)

    const remaining = maxComposerImages - images.length
    if (remaining <= 0) {
      onError(`A message can contain at most ${maxComposerImages} images.`)
      return
    }
    setPreparingImages(true)
    try {
      const prepared = await Promise.all(files.slice(0, remaining).map(prepareComposerImage))
      const accepted = prepared.filter((image): image is ComposerImage => image !== null)
      setImages((current) => [...current, ...accepted].slice(0, maxComposerImages))
      if (accepted.length !== files.length) onError(`Some images could not be prepared (maximum: ${maxComposerImages}).`)
    } catch (cause) {
      onError(cause)
    } finally {
      setPreparingImages(false)
    }
  }

  const stats = snapshot.stats
  const contextUsage = stats?.contextUsage
  const contextPercentValue = typeof contextUsage?.percent === 'number' ? Math.round(contextUsage.percent) : null
  const contextPercent = contextPercentValue === null ? '—' : `${contextPercentValue}%`
  const contextTokens = typeof contextUsage?.tokens === 'number' && typeof contextUsage.contextWindow === 'number'
    ? `${formatTokens(contextUsage.tokens)}/${formatTokens(contextUsage.contextWindow)}`
    : 'Unavailable'
  const cost = typeof stats?.cost === 'number' ? `$${stats.cost.toFixed(2)}` : '—'
  const contextClass = typeof contextUsage?.percent === 'number'
    ? contextUsage.percent >= 40 ? 'context-danger' : contextUsage.percent >= 30 ? 'context-warning-strong' : contextUsage.percent >= 20 ? 'context-warning' : ''
    : ''

  return (
    <form className="composer" onSubmit={(event) => void submit(event)} ref={formRef}>
      {images.length > 0 && <div aria-label="Images to send" className="composer-images">
        {images.map((image, index) => <div className="composer-image" key={image.id}>
          <img alt={`Image ${index + 1} to send`} src={`data:${image.mimeType};base64,${image.data}`} />
          <button aria-label={`Remove image ${index + 1}`} disabled={submitting} onClick={() => setImages((current) => current.filter(({ id }) => id !== image.id))} type="button">×</button>
        </div>)}
      </div>}
      {slashOpen && filteredCommands.length > 0 && (
        <div className="slash-commands" role="listbox">
          {filteredCommands.map((command, index) => (
            <div
              aria-selected={index === slashIndex}
              className={`slash-command-item${index === slashIndex ? ' selected' : ''}`}
              key={String(command.name)}
              onClick={() => selectSlashCommand(String(command.name))}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
            >
              <span className="slash-command-name">/{String(command.name)}</span>
            </div>
          ))}
        </div>
      )}
      <textarea aria-label="Message" disabled={submitting} onPaste={(event) => void handlePaste(event)} ref={textareaRef} value={message} onChange={(event) => {
        const next = event.target.value
        setDraftMessage(next)
        if (next.startsWith('/') && allCommands.length > 0) {
          setSlashOpen(true)
          setSlashFilter(next.slice(1))
          setSlashIndex(-1)
        } else {
          setSlashOpen(false)
        }
      }} onKeyDown={(event) => {
        if (slashOpen && filteredCommands.length > 0) {
          if (event.key === 'Escape') { event.preventDefault(); setSlashOpen(false); return }
          if (event.key === 'ArrowDown') { event.preventDefault(); setSlashIndex((index) => Math.min(index + 1, filteredCommands.length - 1)); return }
          if (event.key === 'ArrowUp') { event.preventDefault(); setSlashIndex((index) => Math.max(index - 1, 0)); return }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            const target = slashIndex >= 0 ? filteredCommands[slashIndex] : filteredCommands[0]
            if (target) selectSlashCommand(String(target.name))
            return
          }
          return
        }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
      }} placeholder="Ask Pi…  / for commands" rows={3} />
      {suggestion && <section aria-label="Prompt improvement suggestion" aria-live="polite" className="prompt-suggestion">
        <div className="prompt-comparison">
          <div><strong>Original</strong><p>{suggestion.original}</p></div>
          <div><strong>Suggestion</strong><p>{suggestion.improved}</p></div>
        </div>
        <div className="prompt-suggestion-meta">
          {suggestion.cost !== undefined && <span className="prompt-improvement-cost">Improvement cost: ${suggestion.cost.toFixed(4)}</span>}
        </div>
        <div className="prompt-suggestion-actions">
          <button onClick={() => { setSuggestion(undefined); textareaRef.current?.focus() }} type="button">Ignore</button>
          <button className="accept" onClick={() => { setDraftMessage(suggestion.improved); setSuggestion(undefined); textareaRef.current?.focus() }} type="button">Use suggestion</button>
        </div>
      </section>}
      <div className="composer-footer">
        <div className="composer-actions">
          <div className="composer-tools">
            {showAgentSelector && <AgentSelect
              agentOptions={agentOptions}
              selectedAgent={selectedAgent}
              agentLoading={agentLoading}
              agentBusy={agentBusy}
              onAgentChange={onAgentChange}
              open={openSelect === 'agent'}
              onOpenChange={(open) => setOpenSelect(open ? 'agent' : null)}
              triggerRef={agentTriggerRef}
            />}
            <ModelSelect
              models={snapshot.models}
              currentModel={currentModel}
              onCommand={onCommand}
              onError={onError}
              open={openSelect === 'model'}
              onOpenChange={(open) => setOpenSelect(open ? 'model' : null)}
              triggerRef={modelTriggerRef}
            />
            <ThinkingSelect
              thinking={thinking}
              onCommand={onCommand}
              onError={onError}
              open={openSelect === 'thinking'}
              onOpenChange={(open) => setOpenSelect(open ? 'thinking' : null)}
              triggerRef={thinkingTriggerRef}
            />

            {running && <BehaviorSelect behavior={behavior} onChange={setBehavior} />}
            <Tooltip label={improving ? 'Improving prompt…' : 'Improve prompt'}><button
              aria-busy={improving}
              aria-label={improving ? 'Improving prompt' : 'Improve prompt'}
              className={`icon-button prompt-improve-button${improving ? ' loading' : ''}`}
              disabled={improving || submitting || !message.trim()}
              onClick={() => void improveDraft()}
              type="button"
            >
              {improving
                ? <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 2a6 6 0 1 0 6 6h-2a4 4 0 1 1-4-4V2Z" /></svg>
                : <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m8 1 1.2 3.8L13 6l-3.8 1.2L8 11 6.8 7.2 3 6l3.8-1.2L8 1Zm4 9 .7 2.3L15 13l-2.3.7L12 16l-.7-2.3L9 13l2.3-.7L12 10Z" /></svg>}
            </button></Tooltip>
          </div>
          <div className="composer-primary-actions">
            <span className="composer-stop-slot">{running && <Tooltip label="Stop generation"><button aria-label="Stop generation" className="icon-button danger" onClick={() => void onAbort().catch(onError)} type="button">
              <svg aria-hidden="true" viewBox="0 0 16 16"><rect height="8" rx="1.5" width="8" x="4" y="4" /></svg>
            </button></Tooltip>}</span>
            <Tooltip label={commandPending ? 'Run command (Enter)' : 'Send message (Enter)'}><button aria-label={commandPending ? 'Run command' : 'Send message'} className={`icon-button send${commandPending ? ' command' : ''}`} disabled={submitting || preparingImages || (!message.trim() && images.length === 0)} type="submit">
              {commandPending
                ? <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M9.2 1.5 3.5 8.4h3.2l-.3 6.1 6.1-7.4H9.1l.1-5.6Z" /></svg>
                : <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m2.5 2.5 11 5.5-11 5.5 1.8-5.1L9 8 4.3 7.6z" /></svg>}
            </button></Tooltip>
          </div>
        </div>
        <ComposerStatusBar
          session={session}
          running={running}
          compacting={compacting}
          cost={cost}
          contextClass={contextClass}
          contextTokens={contextTokens}
          contextPercent={contextPercent}
          contextPercentValue={contextPercentValue}
        />
      </div>
    </form>
  )
})
