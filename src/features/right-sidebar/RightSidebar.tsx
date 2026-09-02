import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type {
  JsonObject,
  QuotaSnapshot,
  SessionEnvironmentSnapshot,
  SessionStats,
} from '../../../shared/types.ts'
import { QuotaWidget } from '../quotas/QuotaWidget.tsx'
import { SessionEnvironmentWidget } from '../session-environment/SessionEnvironmentWidget.tsx'
import { railQuota, type QuotaProvider } from '../quotas/quota-display.ts'
import { formatSessionStats } from '../composer/composer-utils.ts'
import type { ConversationNavigationTarget } from '../conversation/conversation-navigation.ts'
import { SessionIndexWidget } from '../session-index/SessionIndexWidget.tsx'
import { SessionAnalysisWidget } from '../session-analysis/SessionAnalysisWidget.tsx'
import type { SessionAnalysis } from '../session-analysis/session-analysis.ts'
import { BrowserDebugWidget } from '../browser/BrowserDebugWidget.tsx'
import { maxRightSidebarWidth, minRightSidebarWidth, type RightWidget } from './right-sidebar.ts'
import { WidgetLayout } from './WidgetLayout.tsx'

export interface RailAction {
  key: string
  icon: ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}

/** Coordinates the sidebar panels, their common rail, and resizing. */
export function RightSidebar({
  activeSessionId,
  activeWidget,
  analysis,
  analysisAvailable,
  currentQuotaProvider,
  environment,
  onConversationNavigate,
  onOpenBrowser,
  onResize,
  sessionCommands,
  sessionMessages,
  sessionMessagesAvailable,
  sessionState,
  sessionStats,
  quotas,
  width,
  workspacePath,
  railActions,
  onEnvironmentRefresh,
  onQuotaRefresh,
  onQuotaReset,
  onWidgetSelect,
}: {
  activeSessionId: string
  activeWidget: RightWidget | null
  analysis: SessionAnalysis | null
  analysisAvailable: boolean
  currentQuotaProvider: QuotaProvider | undefined
  environment: SessionEnvironmentSnapshot | null
  onConversationNavigate: (target: ConversationNavigationTarget) => void
  onOpenBrowser: () => void
  onResize: (width: number) => void
  sessionCommands: readonly JsonObject[]
  sessionMessages: readonly JsonObject[]
  sessionMessagesAvailable: boolean
  sessionState: JsonObject | null
  sessionStats: SessionStats | null
  quotas: QuotaSnapshot | null
  width: number
  workspacePath: string
  railActions: RailAction[]
  onEnvironmentRefresh: () => Promise<void>
  onQuotaRefresh: () => Promise<void>
  onQuotaReset: () => Promise<{ ok: boolean; error?: string }>
  onWidgetSelect: (widget: RightWidget) => void
}) {
  const collapsed = activeWidget === null || (activeWidget === 'analysis' && !analysis)
  const quotaSummary = railQuota(quotas, currentQuotaProvider)
  const contextStats = formatSessionStats(sessionStats)
  const contextHasUsage = contextStats.contextPercentValue !== null
    && contextStats.contextTokens !== 'Unavailable'
  const contextTooltip = contextHasUsage
    ? `Context ${contextStats.contextTokens} (${contextStats.contextPercent})${
      environment && environment.tools.length > 0 ? ` · ${environment.tools.length} tools` : ''
    }`
    : 'Session context'

  /** Installs temporary listeners needed for panel pointer resizing. */
  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const handle = event.currentTarget
    const initialX = event.clientX
    const initialWidth = width
    handle.setPointerCapture(event.pointerId)

    const resize = (moveEvent: PointerEvent): void =>
      onResize(initialWidth + initialX - moveEvent.clientX)
    const stop = (): void => {
      handle.removeEventListener('pointermove', resize)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      handle.removeEventListener('lostpointercapture', stop)
    }

    handle.addEventListener('pointermove', resize)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
    handle.addEventListener('lostpointercapture', stop)
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const adjustment = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0
    if (adjustment) {
      event.preventDefault()
      onResize(width + adjustment)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onResize(minRightSidebarWidth)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onResize(maxRightSidebarWidth)
    }
  }

  return (
    <aside className='right-sidebar' aria-label='Workspace tools'>
      {!collapsed && (
        <div className='right-sidebar-panel'>
          <div
            aria-controls={activeWidget ? `${activeWidget}-panel` : undefined}
            aria-label='Resize sidebar panel'
            aria-orientation='vertical'
            aria-valuemax={maxRightSidebarWidth}
            aria-valuemin={minRightSidebarWidth}
            aria-valuenow={width}
            className='right-sidebar-resize-handle'
            onKeyDown={resizeWithKeyboard}
            onPointerDown={startResize}
            role='separator'
            tabIndex={0}
          />
          <section
            aria-label={panelLabel(activeWidget)}
            className='right-sidebar-content'
            id={`${activeWidget}-panel`}
            key={activeWidget ?? 'empty'}
          >
            {activeWidget === 'index' && (
              <SessionIndexWidget
                activeSessionId={activeSessionId}
                messages={sessionMessages}
                onNavigate={onConversationNavigate}
                sessionMessagesAvailable={sessionMessagesAvailable}
              />
            )}
            {activeWidget === 'analysis' && analysis && (
              <WidgetLayout
                header={
                  <div>
                    <strong>Session analysis</strong>
                    <span>
                      {analysis
                        .requests
                        .length} request{analysis
                          .requests
                          .length > 1
                        ? 's'
                        : ''} analyzed
                    </span>
                  </div>
                }
              >
                <SessionAnalysisWidget
                  analysis={analysis}
                  onNavigate={onConversationNavigate}
                  sessionId={activeSessionId}
                />
              </WidgetLayout>
            )}
            {activeWidget === 'quotas' && (
              <QuotaWidget onRefresh={onQuotaRefresh} onReset={onQuotaReset} quotas={quotas} />
            )}
            {activeWidget === 'environment' && (
              <SessionEnvironmentWidget
                commands={sessionCommands}
                environment={environment}
                onRefresh={onEnvironmentRefresh}
                stats={sessionStats}
                state={sessionState}
              />
            )}
            {activeWidget === 'browser' && (
              <BrowserDebugWidget onOpenBrowser={onOpenBrowser} workspacePath={workspacePath} />
            )}
          </section>
        </div>
      )}
      <div className='right-sidebar-rail'>
        <div aria-label='Current session' className='right-sidebar-rail-group' role='group'>
          <Tooltip label='Session index'>
            <button
              aria-controls={activeWidget === 'index' ? 'index-panel' : undefined}
              aria-expanded={activeWidget === 'index'}
              aria-label={activeWidget === 'index'
                ? 'Collapse session index'
                : 'Expand session index'}
              className='rail-tab'
              onClick={() => onWidgetSelect('index')}
              type='button'
            >
              <span aria-hidden='true'>☷</span>
            </button>
          </Tooltip>
          {analysisAvailable && (
            <Tooltip label='Session analysis'>
              <button
                aria-controls={activeWidget === 'analysis' ? 'analysis-panel' : undefined}
                aria-expanded={activeWidget === 'analysis'}
                aria-label={activeWidget === 'analysis'
                  ? 'Collapse session analysis'
                  : 'Expand session analysis'}
                className='rail-tab'
                onClick={() => onWidgetSelect('analysis')}
                type='button'
              >
                <span aria-hidden='true'>∑</span>
                {analysis && analysis.failedToolCalls > 0 && (
                  <small>{analysis.failedToolCalls}</small>
                )}
              </button>
            </Tooltip>
          )}
          <Tooltip label={contextTooltip}>
            <button
              aria-controls={activeWidget === 'environment' ? 'environment-panel' : undefined}
              aria-expanded={activeWidget === 'environment'}
              aria-label={`${
                activeWidget === 'environment' ? 'Collapse' : 'Expand'
              } context panel. ${contextTooltip}`}
              className='rail-tab'
              onClick={() => onWidgetSelect('environment')}
              type='button'
            >
              <span
                aria-hidden='true'
                className={`context-rail-value ${contextStats.contextClass}`}
              >
                <ContextRailIcon />
                {contextHasUsage && (
                  <>
                    <span className='context-rail-tokens'>{contextStats.contextTokens}</span>
                    <span className='context-rail-meter'>
                      <small>{contextStats.contextPercent}</small>
                      <progress max={100} value={contextStats.contextPercentValue ?? 0} />
                    </span>
                  </>
                )}
              </span>
            </button>
          </Tooltip>
        </div>
        <div aria-label='Current workspace' className='right-sidebar-rail-group' role='group'>
          {railActions.map((action) => (
            <Tooltip key={action.key} label={action.label}>
              <button
                aria-label={action.label}
                className='rail-tab'
                disabled={action.disabled}
                onClick={action.onClick}
                type='button'
              >
                {action.icon}
              </button>
            </Tooltip>
          ))}
        </div>
        <div aria-label='Global' className='right-sidebar-rail-group' role='group'>
          <Tooltip label='Browser system'>
            <button
              aria-controls={activeWidget === 'browser' ? 'browser-panel' : undefined}
              aria-expanded={activeWidget === 'browser'}
              aria-label={`${activeWidget === 'browser' ? 'Collapse' : 'Expand'} browser system`}
              className='rail-tab'
              onClick={() => onWidgetSelect('browser')}
              type='button'
            >
              <BrowserSystemIcon />
            </button>
          </Tooltip>
          <Tooltip label={quotaSummary?.label ?? 'Quotas'}>
            <button
              aria-controls={activeWidget === 'quotas' ? 'quotas-panel' : undefined}
              aria-expanded={activeWidget === 'quotas'}
              aria-label={`${activeWidget === 'quotas' ? 'Collapse' : 'Expand'} quota panel${
                quotaSummary ? `. ${quotaSummary.label}` : ''
              }`}
              className='rail-tab'
              onClick={() => onWidgetSelect('quotas')}
              type='button'
            >
              <span aria-hidden='true' className='quota-rail-value'>
                <span>{quotaSummary?.value ?? '%'}</span>
                {quotaSummary?.secondaryValue && <span>{quotaSummary.secondaryValue}</span>}
              </span>
              {quotaSummary?.stale && <small>!</small>}
            </button>
          </Tooltip>
        </div>
      </div>
    </aside>
  )
}

/** Layered mark signalling accumulated conversation context. */
function ContextRailIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='12'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.8'
      viewBox='0 0 24 24'
      width='12'
    >
      <path d='M12 3 2.5 8.5 12 14l9.5-5.5L12 3z' />
      <path d='M4 12.8 12 17.4l8-4.6' />
      <path d='M4 17 12 21.6 20 17' />
    </svg>
  )
}

function BrowserSystemIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='18'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.7'
      viewBox='0 0 24 24'
      width='18'
    >
      <rect height='15' rx='2' width='19' x='2.5' y='4.5' />
      <path d='M2.5 8.5h19M6 6.5h.01M9 6.5h.01' />
      <path d='M9 16h6M12 13v6' />
    </svg>
  )
}

function panelLabel(activeWidget: RightWidget | null): string {
  return activeWidget === 'index'
    ? 'Session index'
    : activeWidget === 'analysis'
    ? 'Session analysis'
    : activeWidget === 'quotas'
    ? 'Provider quotas'
    : activeWidget === 'browser'
    ? 'Browser system'
    : 'Session environment'
}
