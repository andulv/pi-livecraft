import { parseTerminalInput, parseTerminalResize } from './session.ts'

/**
 * An unacknowledged-but-congested socket is polled at this interval until the tab drains;
 * the PTY gate pauses reading while congested, so only this poll resumes it.
 */
export const terminalCongestionPollMs = 100
/** Outbound bytes buffered before the PTY read is paused. */
export const terminalCongestionLimitBytes = 512 * 1024
export const terminalPingIntervalMs = 30_000

/** The subset of `ws` the terminal session needs; a fake in tests implements the same. */
export interface TerminalSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: 'message', listener: (data: string) => void): void
  on(event: 'close', listener: () => void): void
  on(event: 'error', listener: () => void): void
  ping(): void
  readonly bufferedAmount: number
}

/** The subset of `TerminalSession` the terminal socket needs. */
export interface TerminalSocketSession {
  status(): { state: string }
  replay(lastEventId?: number): Array<{ name: 'output' | 'status'; json: string; id?: number }>
  subscribe(subscriber: (event: 'output' | 'status', json: string, id?: number) => void): {
    unsubscribe(): void
    setCongested(blocked: boolean): void
  }
  write(data: string): void
  resize(cols: number, rows: number): void
}

export interface TerminalSocketOptions {
  lastEventId?: number
  pingIntervalMs?: number
  congestionLimitBytes?: number
  congestionPollMs?: number
}

/**
 * One embedded-terminal viewer on one WebSocket. Terminal output is ordered and lossless,
 * so instead of dropping, an outbound backlog pauses the PTY read (the session's congestion
 * gate) until the tab drains; the replay buffer resumes the tab from its last seen event id
 * after a reconnect. Input and resize arrive on the same socket. See
 * plans/proposals/browser-websocket-transport.md (rollout step 3).
 */
export function attachTerminalSocket(
  socket: TerminalSocket,
  session: TerminalSocketSession,
  options: TerminalSocketOptions = {},
): void {
  const pingIntervalMs = options.pingIntervalMs ?? terminalPingIntervalMs
  const congestionLimit = options.congestionLimitBytes ?? terminalCongestionLimitBytes
  const congestionPollMs = options.congestionPollMs ?? terminalCongestionPollMs

  let closed = false
  let congested = false
  let congestionTimer: ReturnType<typeof setInterval> | undefined

  const send = (value: unknown): void => {
    if (!closed) socket.send(JSON.stringify(value))
  }

  const pauseIfCongested = (): void => {
    if (closed || congested || !subscription || socket.bufferedAmount < congestionLimit) return
    congested = true
    subscription.setCongested(true)
    congestionTimer = setInterval(() => {
      if (closed || socket.bufferedAmount < congestionLimit / 2) {
        if (congestionTimer !== undefined) clearInterval(congestionTimer)
        congestionTimer = undefined
        if (!closed) {
          congested = false
          subscription?.setCongested(false)
        }
      }
    }, congestionPollMs)
    congestionTimer.unref?.()
  }

  const deliver = (event: 'output' | 'status', json: string, id?: number): void => {
    if (closed) return
    if (event === 'status') {
      send({ type: 'status', status: JSON.parse(json) })
      return
    }
    pauseIfCongested()
    if (closed) return
    send({ type: 'output', id, ...(JSON.parse(json) as { data: string }) })
  }

  let subscription: ReturnType<typeof session.subscribe> | undefined

  socket.on('message', (data: string) => {
    let value: unknown
    try {
      value = JSON.parse(data)
    } catch {
      return
    }
    if (!value || typeof value !== 'object') return
    const message = value as { type?: unknown }
    if (message.type === 'input') {
      const input = parseTerminalInput(message)
      if (input === null) {
        socket.close(4003, 'Invalid terminal input payload')
        return
      }
      session.write(input)
      return
    }
    if (message.type === 'resize') {
      const resize = parseTerminalResize(message)
      if (resize === null) {
        socket.close(4003, 'Invalid terminal resize payload')
        return
      }
      session.resize(resize.cols, resize.rows)
      return
    }
  })
  socket.on('close', () => {
    closed = true
    if (congestionTimer !== undefined) clearInterval(congestionTimer)
    subscription?.setCongested(false)
    subscription?.unsubscribe()
  })
  socket.on('error', () => {
    socket.close()
  })

  const ping = setInterval(() => {
    if (!closed) socket.ping()
  }, pingIntervalMs)
  ping.unref?.()
  socket.on('close', () => clearInterval(ping))

  // Replay the buffered tail after the client's resume offset first; both this loop and
  // the subscribe below are synchronous, so no live event can slip between them.
  for (const item of session.replay(options.lastEventId)) {
    deliver(item.name, item.json, item.id)
  }
  subscription = session.subscribe((event, json, id) => deliver(event, json, id))
}
