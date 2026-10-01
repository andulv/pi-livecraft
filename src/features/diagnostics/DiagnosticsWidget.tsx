import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type {
  DiagnosticsSnapshot,
  OperationsSnapshot,
  StabilitySnapshot,
} from '../../../shared/types.ts'
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
                <span>Cache hit</span>
                <code>{snapshot.cache.hits}</code>
                <span>Cache miss</span>
                <code>{snapshot.cache.misses}</code>
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
            <StabilitySection stability={snapshot.stability} />
            <OperationSections label='Backend' operations={snapshot.operations} />
            <OperationSections label='Manager' operations={snapshot.managerOperations} />
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

/**
 * Shows the backend's event-loop delay, open long-lived streams, and shared-browser capture
 * for the latest window plus the worst of the retained ten minutes.
 */
function StabilitySection({ stability }: { stability: StabilitySnapshot }) {
  const latest = stability.recent.at(-1)
  if (!latest) return null
  const worstLoopMs = Math.max(...stability.recent.map((window) => window.loopMaxMs))
  const streams = stability.streams
  const openStreams = streams['events'] + streams['browser-frames'] + streams['terminal']
  const fps = Math.round(latest.browser.frames / (stability.windowMs / 1000))
  return (
    <section className='diagnostics-section'>
      <h3>Stability</h3>
      <div className='diagnostics-rows'>
        <span title='Event-loop delay in the latest window: p99 / max'>Event loop</span>
        <code>{latest.loopP99Ms}/{latest.loopMaxMs} ms</code>
        <span title='Worst event-loop delay in the retained windows'>Worst (10 min)</span>
        <code>{worstLoopMs} ms</code>
        <span title='Open streams: events / browser frames / terminal, across all clients. Chrome allows six HTTP/1.1 connections per origin.'>
          Open streams
        </span>
        <code>
          {openStreams} ({streams['events']}/{streams['browser-frames']}/{streams['terminal']}){' '}
          · peak {stability.peakStreams}
        </code>
        <span title='Shared-browser screencast in the latest window'>Browser capture</span>
        <code>{fps} fps · {latest.browser.viewers} viewers</code>
      </div>
    </section>
  )
}

const managerUnavailableHint =
  'The manager is unreachable or runs a revision without operation diagnostics; '
  + 'restart it from the update notice when idle.'

/** Renders one process's operation ledger: totals, triggers, and the newest entries. */
function OperationSections(
  { label, operations }: { label: string; operations: OperationsSnapshot | null },
) {
  if (!operations) {
    return (
      <section className='diagnostics-section'>
        <h3>{label} operations</h3>
        <div className='diagnostics-rows'>
          <span title={managerUnavailableHint}>Unavailable</span>
          <code>—</code>
        </div>
      </section>
    )
  }
  const totals = Object
    .entries(operations.totals)
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, 10)
  const triggers = Object
    .entries(operations.triggers)
    .sort((left, right) => right[1].operations - left[1].operations)
    .slice(0, 10)
  const recent = [...operations.recent].reverse().slice(0, 8)
  if (totals.length === 0) return null
  return (
    <>
      <section className='diagnostics-section'>
        <h3>{label} operations · {operations.inFlight} running</h3>
        <div className='diagnostics-rows'>
          {totals.map(([operation, total]) => (
            <Fragment key={operation}>
              <span title={operation}>{operation}</span>
              <code title='count · average ms / max ms'>
                {total.count} · {Math.round(total.totalMs / total.count)}/{total.maxMs} ms
                {total.failures > 0 && ` · ${total.failures} failed`}
              </code>
            </Fragment>
          ))}
        </div>
      </section>
      <section className='diagnostics-section'>
        <h3>{label} triggers</h3>
        <div className='diagnostics-rows'>
          {triggers.map(([trigger, total]) => (
            <Fragment key={trigger}>
              <span title={trigger}>{trigger}</span>
              <code>{total.operations} / {total.requests} req</code>
            </Fragment>
          ))}
        </div>
      </section>
      <section className='diagnostics-section'>
        <h3>{label} recent operations</h3>
        <ul className='diagnostics-events'>
          {recent.map((operation) => {
            const name = `${operation.kind}:${operation.detail}`
            const time = new Date(operation.t).toLocaleTimeString()
            const failed = operation.ok ? '' : ' · failed'
            return (
              <li
                key={operation.sequence}
                title={`${name} · ${operation.route} ← ${operation.cause}`}
              >
                <code>
                  {`${time} ${operation.durationMs} ms ${name} · ${operation.cause}${failed}`}
                </code>
              </li>
            )
          })}
        </ul>
      </section>
    </>
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
