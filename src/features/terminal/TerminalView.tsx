import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  resizeTerminal,
  sendTerminalInput,
  startTerminalSession,
  subscribeTerminalOutput,
} from '../../api.ts'
import type { TerminalSessionStatus } from '../../../shared/types.ts'
import { cwdFromOsc3008, cwdFromOsc7, cwdFromTerminalTitle } from './terminal-cwd.ts'
import { terminalKeyAction } from './terminal-key.ts'

/** Client-side scrollback lines; the server keeps only the bounded replay buffer. */
const scrollbackLines = 5000

/** Human-driven embedded shell backed by a backend PTY and the SSE output stream. */
export function TerminalView({ terminalId, workspacePath }: {
  terminalId: string
  workspacePath: string
}) {
  const [status, setStatus] = useState<TerminalSessionStatus>({ state: 'starting' })
  const [currentDirectory, setCurrentDirectory] = useState(workspacePath)
  const target = useMemo(() => ({ terminalId, workspacePath }), [terminalId, workspacePath])
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const previousStateRef = useRef<TerminalSessionStatus['state']>('starting')
  const live = status.state === 'live'

  // Reset the pane only when the target instance changes.
  const previousTargetRef = useRef(target)
  useEffect(() => {
    if (previousTargetRef.current === target) return
    previousTargetRef.current = target
    previousStateRef.current = 'starting'
    setStatus({ state: 'starting' })
    setCurrentDirectory(workspacePath)
  }, [target, workspacePath])

  // Create the terminal surface once per target; it survives status changes.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const terminal = new Terminal({
      fontSize: 12,
      scrollback: scrollbackLines,
      theme: readTerminalTheme(),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    fit.fit()
    terminal.focus()
    terminal.attachCustomKeyEventHandler((event) => {
      const action = terminalKeyAction(event, terminal.hasSelection())
      if (action === 'passthrough') return true
      // Keep terminal keys out of application shortcuts. Copy keeps the native
      // browser action; interrupt sends ETX exactly once instead of asking xterm
      // to apply its platform-dependent Ctrl+C behavior.
      event.stopPropagation()
      if (action === 'copy') return false
      event.preventDefault()
      sendTerminalInput(target, '\x03')
      return false
    })
    terminalRef.current = terminal
    fitRef.current = fit

    const updateDirectory = (directory: string | null): void => {
      if (directory) setCurrentDirectory(directory)
    }
    const metadataListeners = [
      terminal.parser.registerOscHandler(7, (data) => {
        updateDirectory(cwdFromOsc7(data))
        return true
      }),
      terminal.parser.registerOscHandler(3008, (data) => {
        updateDirectory(cwdFromOsc3008(data))
        return true
      }),
      terminal.onTitleChange((title) => updateDirectory(cwdFromTerminalTitle(title))),
    ]

    const resizeObserver = new ResizeObserver(() => {
      if (host.clientHeight === 0) return
      fit.fit()
      const dimensions = fit.proposeDimensions()
      if (dimensions && dimensions.cols > 0 && dimensions.rows > 0) {
        resizeTerminal(target, dimensions.cols, dimensions.rows)
      }
    })
    resizeObserver.observe(host)

    // Re-read theme variables when the app switches between light and dark.
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = readTerminalTheme()
    })
    themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme'] })

    const dataListener = terminal.onData((data) => sendTerminalInput(target, data))
    return () => {
      resizeObserver.disconnect()
      themeObserver.disconnect()
      dataListener.dispose()
      for (const listener of metadataListeners) listener.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [target])

  // Subscribe before starting so the buffer replay lands before fresh output.
  useEffect(() => {
    let active = true
    const unsubscribe = subscribeTerminalOutput(target, {
      onOutput: (base64) => terminalRef.current?.write(base64ToBytes(base64)),
      onStatus: (next) => {
        if (!active) return
        if (
          (previousStateRef.current === 'exited' || previousStateRef.current === 'crashed')
          && next.state === 'starting'
        ) terminalRef.current?.reset()
        previousStateRef.current = next.state
        setStatus(next)
      },
    })
    void startTerminalSession(target)
      .then((next) => {
        if (!active) return
        previousStateRef.current = next.state
        setStatus(next)
      })
      .catch(() => {
        if (!active) return
        previousStateRef.current = 'crashed'
        setStatus({ state: 'crashed', error: 'The terminal session could not start' })
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [target])

  function restart(): void {
    void startTerminalSession(target)
      .then((next) => {
        previousStateRef.current = next.state
        setStatus(next)
      })
      .catch(() => {})
  }

  return (
    <div aria-label='Terminal' className='terminal-view'>
      {status.state === 'crashed' && status.error && (
        <p className='terminal-session-error' role='alert'>
          {status
            .error}
        </p>
      )}
      <div
        className='terminal-surface'
        onClick={() => terminalRef.current?.focus()}
        ref={hostRef}
      />
      <div
        aria-label={`Current terminal directory: ${currentDirectory}`}
        className='terminal-statusline'
        title={currentDirectory}
      >
        <span>pwd</span>
        <code>{currentDirectory}</code>
      </div>
      {!live && (
        <div aria-live='polite' className='terminal-veil'>
          {status.state === 'starting' && <p>Starting shell…</p>}
          {status.state === 'exited' && (
            <>
              <p>The shell session has ended.</p>
              <button onClick={restart} type='button'>Restart</button>
            </>
          )}
          {status.state === 'crashed' && (
            <>
              <p>Terminal unavailable.</p>
              <button onClick={restart} type='button'>Retry</button>
            </>
          )}
          {status.state === 'off' && <button onClick={restart} type='button'>Start shell</button>}
        </div>
      )}
    </div>
  )
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Reads theme variables so the terminal matches both themes without hard-coded colors. */
function readTerminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement)
  const variable = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback
  const canvas = variable('--canvas', '#141419')
  const ink = variable('--ink', '#d6d6de')
  const accent = variable('--accent', '#4f8cff')
  return {
    background: canvas,
    foreground: ink,
    cursor: accent,
    cursorAccent: variable('--on-accent', '#ffffff'),
    selectionBackground: variable('--accent-soft', '#2b3b5e'),
    black: canvas,
    red: variable('--danger', '#e5484d'),
    green: variable('--success', '#2fbf71'),
    yellow: variable('--warning', '#f5a524'),
    blue: variable('--file-icon-blue', '#5b9bf8'),
    magenta: variable('--file-icon-pink', '#e58ee0'),
    cyan: variable('--secondary', '#6fb3c8'),
    white: variable('--muted', '#a0a0ab'),
    brightBlack: variable('--line-strong', '#4a4a55'),
    brightRed: variable('--danger', '#e5484d'),
    brightGreen: variable('--success', '#2fbf71'),
    brightYellow: variable('--warning-strong', '#ffc06e'),
    brightBlue: variable('--file-icon-blue', '#5b9bf8'),
    brightMagenta: variable('--file-icon-pink', '#e58ee0'),
    brightCyan: variable('--secondary', '#6fb3c8'),
    brightWhite: ink,
  }
}
