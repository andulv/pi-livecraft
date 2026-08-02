import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { JsonLineDecoder, encodeJsonLine } from '../server/jsonl.ts'
import type { JsonObject } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

test('exposes current Pi commands over RPC', { timeout: 30_000 }, async () => {
  const pi = spawn('pi', ['--mode', 'rpc', '--offline', '--no-session'], {
    cwd: join(homedir(), '.pi'),
    env: { ...process.env, PI_OFFLINE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const values: JsonObject[] = []
  const waiters = new Set<() => void>()
  let stderr = ''
  const decoder = new JsonLineDecoder((value) => {
    if (isObject(value)) values.push(value)
    for (const notify of waiters) notify()
  })
  pi.stdout.on('data', (chunk: Buffer) => decoder.push(chunk))
  pi.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  try {
    const commandsResponse = waitFor((value) =>
      value.type === 'response' && value.id === 'commands'
    )
    pi.stdin.write(encodeJsonLine({ id: 'commands', type: 'get_commands' }))
    const response = await commandsResponse
    assert.equal(response.success, true)
    const data = response.data
    assert.ok(isObject(data))
    assert.ok(Array.isArray(data.commands))
    assert.ok(data.commands.length > 0)
    assert.ok(
      data.commands.every((command) => isObject(command) && typeof command.name === 'string'),
    )
  } finally {
    pi.kill('SIGTERM')
  }

  function waitFor(predicate: (value: JsonObject) => boolean): Promise<JsonObject> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(check)
        reject(new Error(`Timed out waiting for Pi RPC event. stderr: ${stderr}`))
      }, 15_000)
      function check(): void {
        const index = values.findIndex(predicate)
        if (index === -1) return
        clearTimeout(timeout)
        waiters.delete(check)
        resolve(values.splice(index, 1)[0])
      }
      waiters.add(check)
      check()
    })
  }
})
