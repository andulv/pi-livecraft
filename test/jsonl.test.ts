import assert from 'node:assert/strict'
import test from 'node:test'
import { JsonLineDecoder, MAX_SESSION_RECORD_SIZE } from '../server/jsonl.ts'

test('decodes session records larger than the default JSONL limit', () => {
  const values: unknown[] = []
  const decoder = new JsonLineDecoder((value) => values.push(value), MAX_SESSION_RECORD_SIZE)
  const payload = 'x'.repeat(5 * 1024 * 1024)

  decoder.push(`${JSON.stringify({ payload })}\n`)

  assert.equal(values.length, 1)
  assert.equal((values[0] as { payload: string }).payload.length, payload.length)
})
