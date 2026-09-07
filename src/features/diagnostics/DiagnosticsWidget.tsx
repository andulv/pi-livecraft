import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { DiagnosticsSnapshot } from '../../../shared/types.ts'
import { getDiagnostics } from '../../api.ts'
import './diagnostics.css'
import { Tooltip } from '../../components/Tooltip.tsx'
import { WidgetLayout } from '../right-sidebar/WidgetLayout.tsx'

const pollIntervalMs = 5_000

/** Shows the backend's bounded, content-free diagnostics: route counters, snapshot
 *  stage timings, and recent events. Self-polling; holds no cross-feature state. */
export function DiagnosticsWidget() {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const requestSequenceRef = useRef(0)

  const refresh = useCallback(async (showProgress = false): Promise<void> => {
    const sequence = ++requestSequenceRef.current
    if (showProgress) setRefreshing(true)
    try {
      const next = await getDiagnostics()
      if (sequence !== requestSequenceRef.current) return
      setSnapshot(next)
      setError(null)
    } catch (cause) {
      if (sequence !== requestSequenceRef.current) return
      setError(cause instanceof Error ? cause.message : 'Could not read diagnostics.')
    } finally {
      if (showProgress) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh(true)
    const timer = window.setInterval(() => void refresh(), pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [refresh])

  const routes = snapshot
    ? Object.entries(snapshot.requests).sort((left, right) => right[1] - left[1])
    : []
  const stages = snapshot ? [...snapshot.recentStages].reverse().slice(0, 8) : []
  const events = snapshot ? [...snapshot.recentEvents].reverse().slice(0, 12) : []
  const topRoutes = routes.slice(0, 10)
  return (
    <WidgetLayout
      header={
        <>
          <div>
            <strong>Diagnostics</strong>
            <span>{snapshot ? `Backend up ${formatUptime(snapshot.uptimeMs)}` : 'Reading…'}</span>
          </div>
          <Tooltip label='Refresh'>
            <button
              aria-label='Refresh diagnostics'
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
        {!snapshot && !error && <p className='browser-debug-empty'>Reading diagnostics…</p>}
        {snapshot && (
          <>
            <section className='diagnostics-section'>
              <h3>Snapshots</h3>
              <div className='diagnostics-rows'>
                <span>Full</span>
                <code>
                  {snapshot.snapshots.full} · {formatBytes(snapshot.snapshots.fullBytes)}
                </code>
                <span>Delta</span>
                <code>
                  {snapshot.snapshots.delta} · {formatBytes(snapshot.snapshots.deltaBytes)}
                </code>
                <span>Errors</span>
                <code>{snapshot.errors}</code>
                <span>SSE opens</span>
                <code>{snapshot.sseOpens}</code>
              </div>
            </section>
            {snapshot.recentStages.length > 0 && (
              <section className='diagnostics-section'>
                <h3>Recent snapshot stages</h3>
                <table className='diagnostics-table'>
                  <thead>
                    <tr>
                      <th scope='col'>Mode</th>
                      <th scope='col'>RPC</th>
                      <th scope='col'>Build</th>
                      <th scope='col'>Tpl</th>
                      <th scope='col'>Total</th>
                      <th scope='col'>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stages.map((stage) => (
                      <tr key={stage.sequence}>
                        <td>{stage.mode}</td>
                        <td>{Math.round(stage.rpcMs)}</td>
                        <td>{Math.round(stage.buildMs)}</td>
                        <td>{Math.round(stage.templatesMs)}</td>
                        <td>{Math.round(stage.totalMs)}</td>
                        <td>{formatBytes(stage.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            {topRoutes.length > 0 && (
              <section className='diagnostics-section'>
                <h3>Requests</h3>
                <div className='diagnostics-rows'>
                  {topRoutes.map(([route, count]) => (
                    <Fragment key={route}>
                      <span>{route}</span>
                      <code>{count}</code>
                    </Fragment>
                  ))}
                </div>
              </section>
            )}
            {snapshot.recentEvents.length > 0 && (
              <section className='diagnostics-section'>
                <h3>Recent events</h3>
                <ul className='diagnostics-events'>
                  {events.map((event) => (
                    <li key={event.sequence}>
                      <code>
                        {new Date(event.t).toLocaleTimeString()} {event.kind}
                        {event.route ? ` ${event.route}` : ''}
                        {event.durationMs !== undefined ? ` · ${event.durationMs} ms` : ''}
                        {event.bytes !== undefined ? ` · ${formatBytes(event.bytes)}` : ''}
                        {!event.ok && ' · failed'}
                      </code>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </WidgetLayout>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function formatUptime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}
