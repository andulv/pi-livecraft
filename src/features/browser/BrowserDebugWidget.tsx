import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BrowserInstanceDebugSnapshot,
  BrowserSessionState,
  BrowserSystemDebugSnapshot,
} from '../../../shared/types.ts'
import { getBrowserDebugSnapshot, startBrowserSession, stopBrowserSession } from '../../api.ts'
import { Tooltip } from '../../components/Tooltip.tsx'
import { WidgetLayout } from '../right-sidebar/WidgetLayout.tsx'
import { primaryBrowserId } from './browser-url.ts'
import { useDocumentVisible } from './use-document-visible.ts'

const pollIntervalMs = 2_000

/** Lists all backend-owned browser instances without joining their frame streams. */
export function BrowserDebugWidget({ onOpenBrowser, workspacePath }: {
  onOpenBrowser: () => void
  workspacePath: string
}) {
  const [snapshot, setSnapshot] = useState<BrowserSystemDebugSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [action, setAction] = useState<'start' | 'stop' | null>(null)
  const [copiedInstance, setCopiedInstance] = useState<string | null>(null)
  const requestSequenceRef = useRef(0)
  const documentVisible = useDocumentVisible()
  const target = { browserId: primaryBrowserId, workspacePath }

  const refresh = useCallback(async (showProgress = false): Promise<void> => {
    const sequence = ++requestSequenceRef.current
    if (showProgress) setRefreshing(true)
    try {
      const next = await getBrowserDebugSnapshot(workspacePath)
      if (sequence !== requestSequenceRef.current) return
      setSnapshot(next)
      setError(null)
    } catch (cause) {
      if (sequence !== requestSequenceRef.current) return
      setError(cause instanceof Error ? cause.message : 'Could not read browser diagnostics.')
    } finally {
      if (showProgress) setRefreshing(false)
    }
  }, [workspacePath])

  useEffect(() => {
    // Polling pauses while the document is hidden; each poll opens a short-lived
    // CDP connection per live instance, so an unwatched app stays silent.
    if (!documentVisible) return
    void refresh(true)
    const timer = window.setInterval(() => void refresh(), pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [documentVisible, refresh])

  useEffect(() => {
    if (!copiedInstance) return
    const timer = setTimeout(() => setCopiedInstance(null), 1_500)
    return () => clearTimeout(timer)
  }, [copiedInstance])

  const currentWorkspacePath = snapshot?.currentWorkspacePath ?? workspacePath
  const currentInstance = snapshot
    ?.workspaces
    .find((workspace) => workspace.workspacePath === currentWorkspacePath)
    ?.instances
    .find((instance) => instance.browserId === primaryBrowserId)
  const currentState = currentInstance?.status.state ?? 'off'
  const live = currentState === 'live'
  const starting = currentState === 'starting'
  const unavailable = action !== null || starting
  const instanceCount = snapshot?.workspaces.reduce(
    (total, workspace) => total + workspace.instances.length,
    0,
  ) ?? 0
  const workspaceCount = snapshot?.workspaces.length ?? 0
  const subtitle = snapshot
    ? `${instanceCount} browser${instanceCount === 1 ? '' : 's'} · ${workspaceCount} workspace${
      workspaceCount === 1 ? '' : 's'
    }`
    : 'Reading runtime state…'

  async function changeCurrentSession(nextAction: 'start' | 'stop'): Promise<void> {
    setAction(nextAction)
    setError(null)
    try {
      if (nextAction === 'start') await startBrowserSession(target)
      else await stopBrowserSession(target)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${nextAction} the browser.`)
    } finally {
      setAction(null)
    }
  }

  async function copyEndpoint(
    instance: BrowserInstanceDebugSnapshot,
    instanceWorkspacePath: string,
  ): Promise<void> {
    const endpoint = instance.status.endpoint
    if (!endpoint) return
    try {
      await navigator.clipboard.writeText(endpoint)
      setCopiedInstance(instanceKey(instanceWorkspacePath, instance.browserId))
    } catch {
      setError('Could not copy the CDP endpoint.')
    }
  }

  return (
    <WidgetLayout
      footer={
        <div className='browser-debug-actions'>
          <button
            className={live ? 'danger' : 'primary'}
            disabled={unavailable}
            onClick={() => void changeCurrentSession(live ? 'stop' : 'start')}
            type='button'
          >
            {action === 'start'
              ? 'Starting…'
              : action === 'stop'
              ? 'Stopping…'
              : starting
              ? 'Starting…'
              : live
              ? 'Stop current'
              : 'Start current'}
          </button>
          <button className={live ? 'primary' : undefined} onClick={onOpenBrowser} type='button'>
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
          : snapshot.workspaces.length === 0
          ? <p className='browser-debug-empty'>No browser instances are registered.</p>
          : snapshot.workspaces.map((workspace) => (
            <section
              className='browser-debug-section browser-debug-workspace'
              key={workspace.workspacePath}
            >
              <div className='browser-debug-workspace-heading'>
                <div>
                  <h2>{workspaceName(workspace.workspacePath)}</h2>
                  <code title={workspace.workspacePath}>{workspace.workspacePath}</code>
                </div>
                {workspace.workspacePath === currentWorkspacePath && <small>Current</small>}
                <span>{workspace.instances.length}</span>
              </div>
              <div className='browser-debug-instances'>
                {workspace.instances.map((instance) => (
                  <BrowserInstanceDetails
                    copied={copiedInstance
                      === instanceKey(workspace.workspacePath, instance.browserId)}
                    current={workspace.workspacePath === currentWorkspacePath
                      && instance.browserId === primaryBrowserId}
                    instance={instance}
                    key={instance.browserId}
                    onCopy={() => void copyEndpoint(instance, workspace.workspacePath)}
                  />
                ))}
              </div>
            </section>
          ))}
      </div>
    </WidgetLayout>
  )
}

function BrowserInstanceDetails({ copied, current, instance, onCopy }: {
  copied: boolean
  current: boolean
  instance: BrowserInstanceDebugSnapshot
  onCopy: () => void
}) {
  const processCount = instance.processes.length
  const totalCpuTime = instance.processes.reduce(
    (total, process) => total + process.cpuTimeSeconds,
    0,
  )
  return (
    <details className={`browser-debug-instance${current ? ' current' : ''}`}>
      <summary>
        <span
          aria-hidden='true'
          className={`browser-debug-state-dot ${instance.status.state}`}
        />
        <span className='browser-debug-instance-name'>
          <strong>
            {instance.browserId === primaryBrowserId ? 'Main browser' : instance.browserId}
          </strong>
          <small>
            {stateLabel(instance.status.state)} · PID {instance.rootPid ?? '—'} · {processCount}
            {' '}
            process{processCount === 1 ? '' : 'es'}
          </small>
        </span>
        <span
          className='browser-debug-instance-cpu'
          title='Total cumulative CPU time reported by Chrome'
        >
          {formatCpuTime(totalCpuTime)}
        </span>
        <span aria-hidden='true' className='browser-debug-instance-chevron'>›</span>
      </summary>
      <div className='browser-debug-instance-body'>
        {instance.status.error && (
          <p className='browser-debug-error' role='status'>{instance.status.error}</p>
        )}
        <dl className='browser-debug-metrics'>
          <Metric label='Viewers' value={instance.viewerCount.toString()} />
          <Metric label='Frames' value={formatCount(instance.capturedFrames)} />
          <Metric label='Captured' value={formatBytes(instance.capturedBytes)} />
          <Metric
            label='Viewport'
            value={instance.status.viewport
              ? `${instance.status.viewport.width}×${instance.status.viewport.height}`
              : '—'}
          />
        </dl>
        <div className='browser-debug-heading browser-debug-process-heading'>
          <h3>Processes</h3>
          <span>{processCount}</span>
        </div>
        {instance.processError && <p className='browser-debug-warning'>{instance.processError}</p>}
        {instance.processes.length > 0
          ? (
            <ul className='browser-debug-processes'>
              {instance.processes.map((process) => (
                <li key={process.pid}>
                  <span aria-hidden='true' className='browser-debug-process-mark' />
                  <span className='browser-debug-process-name'>
                    <strong>{processTypeLabel(process.type)}</strong>
                    <small>
                      PID {process.pid}
                      {process.pid === instance.rootPid ? ' · root' : ''}
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
          : <p className='browser-debug-empty'>No Chrome processes are running.</p>}
        <div className='browser-debug-runtime'>
          <DebugValue label='URL' value={instance.status.url} />
          <DebugValue label='Profile' value={instance.profilePath} />
          <div className='browser-debug-value'>
            <span>CDP endpoint</span>
            <div>
              <code title={instance.status.endpoint}>{instance.status.endpoint ?? '—'}</code>
              <button disabled={!instance.status.endpoint} onClick={onCopy} type='button'>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </details>
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

function instanceKey(workspacePath: string, browserId: string): string {
  return `${workspacePath}\u0000${browserId}`
}

function workspaceName(workspacePath: string): string {
  return workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ?? workspacePath
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
