import { isObject } from '../../../../shared/is-object.ts'
import { truncateToolText, type ToolCallPresentation } from './shared.ts'

/** Adapts Bash by placing its command in the header and its timeout in the status. */
export function bashPresentation(args: unknown): ToolCallPresentation {
  if (!isObject(args) || typeof args.command !== 'string') return {}

  const command = args.command
  const timeout = typeof args.timeout === 'number' && Number.isFinite(args.timeout)
    ? args.timeout
    : undefined
  return {
    headerDetail: { text: truncateToolText(command, 80).text, title: command },
    pendingDetail: timeout === undefined ? undefined : `timeout: ${timeout}s`,
  }
}
