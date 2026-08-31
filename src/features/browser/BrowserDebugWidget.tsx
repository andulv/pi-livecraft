import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserDebugSnapshot, BrowserSessionState } from '../../../shared/types.ts'
import { getBrowserDebugSnapshot, startBrowserSession, stopBrowserSession } from '../../api.ts'
import { Tooltip } from '../../components/Tooltip.tsx'
import { WidgetLayout } from '../right-sidebar/WidgetLayout.tsx'

const pollIntervalMs = 2_000

/** Observes and controls the backend-owned Chrome session without joining its frame stream. */
export function BrowserDebugWidget({ onOpenBrowser }: { onOpenBrowser: () => void }) {
  const [snapshot, setSnapshot] = useState<BrowserDebugSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [action, setAction] = useState<'start' | 'stop' | null>(null)
  const [copied, setCopied] = useState(false)
  const requestSequenceRef = useRef(0)

  const refresh = useCallback(async (showProgress = false): Promise<void> => {
    const sequence = ++requestSequenceRef.current
    if (showProgress) setRefreshing(true)
    try {
      const next = await getBrowserDebugSnapshot()
      if (sequence !== requestSequenceRef.current) return
      setSnapshot(next)
      setError(null)
    } catch (cause) {
      if (sequence !== requestSequenceRef.current) return
      setError(cause instanceof Error ? cause.message : 'Could not read browser diagnostics.')
    } finally {
      if (showProgress) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh(true)
    const timer = window.setInterval(() => void refresh(), pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1_500)
    return () => clearTimeout(timer)
  }, [copied])

  async function changeSession(nextAction: 'start' | 'stop'): Promise<void> {
    setAction(nextAction)
    setError(null)
    try {
      if (nextAction === 'start') await startBrowserSession()
      else await stopBrowserSession()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${nextAction} the browser.`)
    } finally {
      setAction(null)
    }
  }

  async function copyEndpoint(): Promise<void> {
    const endpoint = snapshot?.status.endpoint
    if (!endpoint) return
    try {
      await navigator.clipboard.writeText(endpoint)
      setCopied(true)
    } catch {
      setError('Could not copy the CDP endpoint.')
    }
  }

  const status = snapshot?.status
  const live = status?.state === 'live'
  const starting = status?.state === 'starting'
  const unavailable = action !== null || starting
  const processCount = snapshot?.processes.length ?? 0
  const subtitle = snapshot
    ? `${stateLabel(snapshot.status.state)} · ${processCount} process${
      processCount === 1 ? '' : 'es'
    }`
    : 'Reading runtime state…'

  return (
    <WidgetLayout
      footer={
        <div className='browser-debug-actions'>
          <button
            className={live ? 'danger' : 'primary'}
            disabled={unavailable}
            onClick={() => void changeSession(live ? 'stop' : 'start')}
            type='button'
          >
            {action === 'start'
              ? 'Starting…'
              : action === 'stop'
              ? 'Stopping…'
              : starting
              ? 'Starting…'
              : live
              ? 'Stop browser'
              : 'Start browser'}
          </button>
          <button
            className={live ? 'primary' : undefined}
            onClick={onOpenBrowser}
            type='button'
          >
            Open pane
          </button>
        </div>
      }
      header={
        <>
          <div>
            <strong>Browser system</strong>
            <span aria-live='polite'>{subtitle}</span>
          </div>
          <Tooltip label='Refresh'>
            <button
              aria-label='Refresh browser diagnostics'
              className='browser-debug-refresh'
              disabled={refreshing}
              onClick={() => void refresh(true)}
              type='button'
            >
              ↻
            </button>
          </Tooltip>
        </>
      }
    >
      <div aria-busy={refreshing} className='browser-debug-content'>
        {error && <p className='browser-debug-error' role='alert'>{error}</p>}
        {!snapshot
          ? !error && <p className='browser-debug-empty'>Reading browser diagnostics…</p>
          : (
            <>
              <section className='browser-debug-section'>
                <div className='browser-debug-state-row'>
                  <span
                    aria-hidden='true'
                    className={`browser-debug-state-dot ${snapshot.status.state}`}
                  />
                  <strong>{stateLabel(snapshot.status.state)}</strong>
                  {snapshot.startedAt && (
                    <span>{formatDuration(snapshot.sampledAt - snapshot.startedAt)}</span>
                  )}
                </div>
                {snapshot.status.error && (
                  <p className='browser-debug-error' role='status'>{snapshot.status.error}</p>
                )}
                <dl className='browser-debug-metrics'>
                  <Metric label='Root PID' value={snapshot.rootPid?.toString() ?? '—'} />
                  <Metric label='Viewers' value={snapshot.viewerCount.toString()} />
                  <Metric label='Frames' value={formatCount(snapshot.capturedFrames)} />
                  <Metric label='Captured' value={formatBytes(snapshot.capturedBytes)} />
                  <Metric
                    label='Viewport'
                    value={snapshot.status.viewport
                      ? `${snapshot.status.viewport.width}×${snapshot.status.viewport.height}`
                      : '—'}
                  />
                  <Metric label='Processes' value={processCount.toString()} />
                </dl>
              </section>

              <section className='browser-debug-section'>
                <div className='browser-debug-heading'>
                  <h2>Chrome processes</h2>
                  <span>{processCount}</span>
                </div>
                {snapshot.processError && (
                  <p className='browser-debug-warning'>{snapshot.processError}</p>
                )}
                {snapshot.processes.length > 0
                  ? (
                    <ul className='browser-debug-processes'>
                      {snapshot.processes.map((process) => (
                        <li key={process.pid}>
                          <span aria-hidden='true' className='browser-debug-process-mark' />
                          <span className='browser-debug-process-name'>
                            <strong>{processTypeLabel(process.type)}</strong>
                            <small>
                              PID {process.pid}
                              {process.pid === snapshot.rootPid ? ' · root' : ''}
                            </small>
                          </span>
                          <span
                            className='browser-debug-process-cpu'
                            title='Cumulative CPU time reported by Chrome'
                          >
                            {formatCpuTime(process.cpuTimeSeconds)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )
                  : (
                    <p className='browser-debug-empty'>
                      {live
                        ? 'Chrome reported no process details.'
                        : 'No Chrome process is running.'}
                    </p>
                  )}
              </section>

              <section className='browser-debug-section'>
                <div className='browser-debug-heading'>
                  <h2>Runtime</h2>
                </div>
                <DebugValue label='URL' value={snapshot.status.url} />
                <DebugValue label='Profile' value={snapshot.profilePath} />
                <div className='browser-debug-value'>
                  <span>CDP endpoint</span>
                  <div>
                    <code title={snapshot.status.endpoint}>{snapshot.status.endpoint ?? '—'}</code>
                    <button
                      disabled={!snapshot.status.endpoint}
                      onClick={() => void copyEndpoint()}
                      type='button'
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
      </div>
    </WidgetLayout>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  )
}

function DebugValue({ label, value }: { label: string; value?: string }) {
  return (
    <div className='browser-debug-value'>
      <span>{label}</span>
      <code title={value}>{value ?? '—'}</code>
    </div>
  )
}

function stateLabel(state: BrowserSessionState): string {
  return {
    off: 'Off',
    starting: 'Starting',
    live: 'Live',
    stopped: 'Stopped',
    crashed: 'Crashed',
  }[state]
}

function processTypeLabel(type: string): string {
  return type
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${remainder}s`
  return `${remainder}s`
}

function formatCpuTime(seconds: number): string {
  if (seconds < 0.01) return '<10ms'
  if (seconds < 1) return `${Math.round(seconds * 1_000)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1_024 ** 3).toFixed(1)} GB`
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en', { notation: value >= 10_000 ? 'compact' : 'standard' }).format(
    value,
  )
}
