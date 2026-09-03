import type { ServerResponse } from 'node:http'

/** Framed writer for one Server-Sent Events response. */
export interface SseWriter {
  /**
   * Writes one named event and reports whether the socket accepted it without
   * congestion. Only events carrying an `id` update the browser's
   * Last-Event-ID bookkeeping, so resumable streams tag replayable events and
   * leave idempotent ones untagged.
   */
  writeEvent(name: string, json: string, id?: number): boolean
  /** Bytes queued on the socket; callers can drop droppable frames past a limit. */
  readonly writableLength: number
}

/** Opens an SSE response with the repo's standard headers. */
export function openSseStream(response: ServerResponse): SseWriter {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  return {
    writeEvent(name, json, id) {
      return id === undefined
        ? response.write(`event: ${name}\ndata: ${json}\n\n`)
        : response.write(`id: ${id}\nevent: ${name}\ndata: ${json}\n\n`)
    },
    get writableLength() {
      return response.writableLength
    },
  }
}

/** Parses an SSE resume offset from a Last-Event-ID header or query value. */
export function parseSseLastEventId(value: unknown): number | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}
