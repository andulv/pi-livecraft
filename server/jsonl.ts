import { StringDecoder } from 'node:string_decoder'

const DEFAULT_MAX_RECORD_SIZE = 4 * 1024 * 1024
/** Pi returns a complete session history in one JSONL record; keep that path bounded separately. */
// ponytail: 64 MiB bounds local RPC buffering; chunk get_entries if larger histories become common.
export const MAX_SESSION_RECORD_SIZE = 64 * 1024 * 1024

/**
 * Decodes a strict JSONL stream without treating Unicode separators as line
 * endings, according to Pi's RPC protocol.
 */
export class JsonLineDecoder {
  readonly #decoder = new StringDecoder('utf8')
  readonly #onValue: (value: unknown) => void
  readonly #maxRecordSize: number
  #buffer = ''

  constructor(onValue: (value: unknown) => void, maxRecordSize = DEFAULT_MAX_RECORD_SIZE) {
    this.#onValue = onValue
    this.#maxRecordSize = maxRecordSize
  }

  push(chunk: Buffer | string): void {
    this.#buffer += typeof chunk === 'string' ? chunk : this.#decoder.write(chunk)
    this.#drain(false)
  }

  end(): void {
    this.#buffer += this.#decoder.end()
    this.#drain(true)
  }

  #drain(flush: boolean): void {
    let newlineIndex = this.#buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      if (newlineIndex > this.#maxRecordSize) this.#throwRecordSizeError()
      this.#parse(this.#buffer.slice(0, newlineIndex))
      this.#buffer = this.#buffer.slice(newlineIndex + 1)
      newlineIndex = this.#buffer.indexOf('\n')
    }

    if (this.#buffer.length > this.#maxRecordSize) this.#throwRecordSizeError()

    if (flush && this.#buffer.length > 0) {
      this.#parse(this.#buffer)
      this.#buffer = ''
    }
  }

  #parse(line: string): void {
    const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line
    if (normalizedLine.length > 0) this.#onValue(JSON.parse(normalizedLine))
  }

  #throwRecordSizeError(): never {
    throw new Error(
      `JSONL record exceeds ${String(this.#maxRecordSize / (1024 * 1024))} MiB`,
    )
  }
}

export function encodeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}
