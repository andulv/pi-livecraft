import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type {
  GitFileDiff,
  GitPushResult,
  GitResetResult,
  GitRevertResult,
  GitSnapshot,
  JsonObject,
  QuotaSnapshot,
  SessionEnvironmentSnapshot,
  SessionStats,
} from '../../../shared/types.ts'
import { GitWidget } from '../git/GitWidget.tsx'
import { QuotaWidget } from '../quotas/QuotaWidget.tsx'
import { SessionEnvironmentWidget } from '../session-environment/SessionEnvironmentWidget.tsx'
import { railQuota, type QuotaProvider } from '../quotas/quota-display.ts'
import { formatSessionStats } from '../composer/composer-utils.ts'
import type { ConversationNavigationTarget } from '../conversation/conversation-navigation.ts'
import { SessionIndexWidget } from '../session-index/SessionIndexWidget.tsx'
import { SessionAnalysisWidget } from '../session-analysis/SessionAnalysisWidget.tsx'
import type { SessionAnalysis } from '../session-analysis/session-analysis.ts'
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
  onResize,
  sessionCommands,
  sessionMessages,
  sessionMessagesAvailable,
  sessionState,
  sessionStats,
  snapshot,
  quotas,
  width,
  railActions,
  onCommit,
  onDiscard,
  onEnvironmentRefresh,
  onFileSelect,
  onPush,
  onQuotaRefresh,
  onRefresh,
  onReset,
  onRevert,
  onWidgetSelect,
}: {
  activeSessionId: string
  activeWidget: RightWidget | null
  analysis: SessionAnalysis | null
  analysisAvailable: boolean
  currentQuotaProvider: QuotaProvider | undefined
  environment: SessionEnvironmentSnapshot | null
  onConversationNavigate: (target: ConversationNavigationTarget) => void
  onResize: (width: number) => void
  sessionCommands: readonly JsonObject[]
  sessionMessages: readonly JsonObject[]
  sessionMessagesAvailable: boolean
  sessionState: JsonObject | null
  sessionStats: SessionStats | null
  snapshot: GitSnapshot | null
  quotas: QuotaSnapshot | null
  width: number
  railActions: RailAction[]
  onCommit: (message: string) => Promise<void>
  onDiscard: (path?: string) => Promise<void>
  onEnvironmentRefresh: () => Promise<void>
  onFileSelect: (path: string, commitHash?: string) => Promise<GitFileDiff>
  onPush: () => Promise<GitPushResult>
  onQuotaRefresh: () => Promise<void>
  onRefresh: () => Promise<void>
  onReset: (hash: string) => Promise<GitResetResult>
  onRevert: (hash: string) => Promise<GitRevertResult>
  onWidgetSelect: (widget: RightWidget) => void
}) {
  const hasChanges = snapshot ? snapshot.files.length > 0 : false

  const collapsed = activeWidget === null || (activeWidget === 'analysis' && !analysis)
    || (activeWidget === 'git' && !snapshot)
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
            {activeWidget === 'git' && snapshot && (
              <GitWidget
                onCommit={onCommit}
                onDiscard={onDiscard}
                onFileSelect={onFileSelect}
                onPush={onPush}
                onRefresh={onRefresh}
                onReset={onReset}
                onRevert={onRevert}
                snapshot={snapshot}
              />
            )}
            {activeWidget === 'quotas' && (
              <QuotaWidget onRefresh={onQuotaRefresh} quotas={quotas} />
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
          {snapshot && (
            <Tooltip label='Git'>
              <button
                aria-controls={activeWidget === 'git' ? 'git-panel' : undefined}
                aria-expanded={activeWidget === 'git'}
                aria-label={activeWidget === 'git' ? 'Collapse Git panel' : 'Expand Git panel'}
                className='rail-tab'
                onClick={() => onWidgetSelect('git')}
                type='button'
              >
                <span aria-hidden='true'>⎇</span>
                {(hasChanges || snapshot.ahead > 0) && (
                  <small>{snapshot.files.length + snapshot.ahead}</small>
                )}
              </button>
            </Tooltip>
          )}
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

function panelLabel(activeWidget: RightWidget | null): string {
  return activeWidget === 'index'
    ? 'Session index'
    : activeWidget === 'analysis'
    ? 'Session analysis'
    : activeWidget === 'quotas'
    ? 'Provider quotas'
    : activeWidget === 'environment'
    ? 'Session environment'
    : 'Git information'
}
