import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import test from 'node:test'

test('accepts commands after an event emitted before Pi finishes starting', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-manager-'))
  const port = 45_000 + (process.pid % 10_000)
  await writeFakePi(directory, true)
  const manager = spawn(process.execPath, ['server/manager.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, PI_LIVECRAFT_MANAGER_PORT: String(port) },
    stdio: 'ignore',
  })
  const client = await connectManager(port)
  try {
    const startupEvent = client.waitForEvent((event) => event.event === 'pi')
    const opening = client.request('open', { cwd: process.cwd(), name: 'Archived', sessionPath: join(directory, 'archived.jsonl') })
    const event = await startupEvent
    const command = await client.request('command', { sessionId: event.sessionId, command: { type: 'get_commands' } })
    assert.equal(command.ok, true)
    await opening
  } finally {
    client.close()
    manager.kill('SIGTERM')
    await once(manager, 'exit')
    await rm(directory, { force: true, recursive: true })
  }
})

test('restarts an exited Pi session when reopening it', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-manager-'))
  const port = 45_000 + (process.pid % 10_000)
  await writeFakePi(directory)
  const manager = spawn(process.execPath, ['server/manager.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, PI_LIVECRAFT_MANAGER_PORT: String(port) },
    stdio: 'ignore',
  })
  const client = await connectManager(port)
  try {
    const first = await client.request('open', { cwd: process.cwd(), name: 'Archived', sessionPath: join(directory, 'archived.jsonl') })
    assert.equal(first.ok, true)

    const stopped = await client.request('command', { sessionId: sessionId(first), command: { type: 'quit_test' } })
    assert.equal(stopped.ok, false)

    const reopened = await client.request('open', { cwd: process.cwd(), name: 'Archived', sessionPath: join(directory, 'archived.jsonl') })
    assert.equal(reopened.ok, true)
    assert.notEqual(sessionId(reopened), sessionId(first))
  } finally {
    client.close()
    manager.kill('SIGTERM')
    await once(manager, 'exit')
    await rm(directory, { force: true, recursive: true })
  }
})

test('improves a prompt with the cheapest isolated model', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-manager-'))
  const port = 45_000 + (process.pid % 10_000)
  await writeFakePi(directory)
  const manager = spawn(process.execPath, ['server/manager.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, PI_LIVECRAFT_MANAGER_PORT: String(port) },
    stdio: 'ignore',
  })
  const client = await connectManager(port)
  try {
    const opened = await client.request('open', { cwd: process.cwd(), name: 'Active', sessionPath: join(directory, 'active.jsonl') })
    const improved = await client.request('improve_prompt', { sessionId: sessionId(opened), prompt: 'Fix it' })
    assert.deepEqual(improved.data, { prompt: 'Fix the failing behavior and validate the result.', cost: 0.0042 })
  } finally {
    client.close()
    manager.kill('SIGTERM')
    await once(manager, 'exit')
    await rm(directory, { force: true, recursive: true })
  }
})

async function writeFakePi(directory: string, emitStartupEvent = false): Promise<void> {
  const path = join(directory, 'pi')
  await writeFile(path, `#!/usr/bin/env node
import readline from 'node:readline'
const isolated = process.argv.includes('--no-session')
const sessionPath = process.argv[process.argv.indexOf('--session') + 1]
const expectedExtension = ${JSON.stringify(join(process.cwd(), 'pi-extensions/ask-user-question.ts'))}
const extensionIndex = process.argv.indexOf('--extension')
if (isolated) {
  for (const flag of ['--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files']) {
    if (!process.argv.includes(flag)) throw new Error('Missing isolation flag: ' + flag)
  }
  if (extensionIndex !== -1) throw new Error('Invalid isolated extension')
  if (process.argv[process.argv.indexOf('--thinking') + 1] !== 'off') throw new Error('Thinking is enabled')
  const systemPrompt = process.argv[process.argv.indexOf('--system-prompt') + 1]
  if (!systemPrompt.includes('task editor')) throw new Error('Missing task editor system prompt')
  if (!systemPrompt.includes('Add no new facts')) throw new Error('Missing no-invention rule')
} else if (extensionIndex === -1 || process.argv[extensionIndex + 1] !== expectedExtension) {
  throw new Error('Missing ask-user-question extension')
}
const emitStartupEvent = ${emitStartupEvent}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line)
  if (command.type === 'quit_test') process.exit(0)
  if (isolated && command.type === 'get_available_models') {
    console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data: { models: [
      { id: 'expensive', provider: 'test', reasoning: false, cost: { input: 1, output: 5 } },
      { id: 'cheap', provider: 'test', reasoning: false, cost: { input: 2, output: 1 } }
    ] } }))
    return
  }
  if (isolated && command.type === 'set_model' && command.modelId !== 'cheap') throw new Error('Wrong model selected')
  if (isolated && command.type === 'prompt') {
    if (command.message !== '<user_prompt>\\nFix it\\n</user_prompt>') throw new Error('Prompt was not delimited')
    console.log(JSON.stringify({ type: 'response', id: command.id, success: true }))
    setTimeout(() => console.log(JSON.stringify({ type: 'agent_settled' })), 5)
    return
  }
  if (isolated && command.type === 'get_session_stats') {
    console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data: { cost: 0.0042 } }))
    return
  }
  if (isolated && command.type === 'get_messages') {
    console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data: { messages: [
      { role: 'assistant', content: [{ type: 'text', text: 'Fix the failing behavior and validate the result.' }] }
    ] } }))
    return
  }
  const data = command.type === 'get_state' ? { sessionFile: sessionPath } : {}
  if (command.type === 'get_state' && emitStartupEvent) {
    console.log(JSON.stringify({ type: 'extension_ui_request', method: 'notify', message: 'Starting' }))
    setTimeout(() => console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data })), 100)
    return
  }
  console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data }))
})
`)
  await chmod(path, 0o755)
}

interface ManagerResponse {
  kind: 'response'
  id: string
  ok: boolean
  data?: unknown
}

interface ManagerEvent {
  kind: 'event'
  event: string
  sessionId: string
}

async function connectManager(port: number): Promise<{ request: (action: string, fields: Record<string, unknown>) => Promise<ManagerResponse>; waitForEvent: (predicate: (event: ManagerEvent) => boolean) => Promise<ManagerEvent>; close: () => void }> {
  const socket = await connectWithRetry(port)
  let buffer = ''
  let requestId = 0
  const pending = new Map<string, (response: ManagerResponse) => void>()
  const events: ManagerEvent[] = []
  const eventWaiters = new Set<() => void>()
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      const response: unknown = JSON.parse(line)
      if (isManagerResponse(response)) {
        pending.get(response.id)?.(response)
        pending.delete(response.id)
        continue
      }
      if (isManagerEvent(response)) {
        events.push(response)
        for (const notify of eventWaiters) notify()
      }
    }
  })

  return {
    request(action, fields) {
      const id = String(++requestId)
      return new Promise((resolve) => {
        pending.set(id, resolve)
        socket.write(`${JSON.stringify({ id, action, ...fields })}\n`)
      })
    },
    waitForEvent(predicate) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          eventWaiters.delete(check)
          reject(new Error('Timed out waiting for manager event'))
        }, 5_000)
        function check(): void {
          const index = events.findIndex(predicate)
          if (index === -1) return
          clearTimeout(timeout)
          eventWaiters.delete(check)
          resolve(events.splice(index, 1)[0])
        }
        eventWaiters.add(check)
        check()
      })
    },
    close: () => socket.end(),
  }
}

async function connectWithRetry(port: number): Promise<Socket> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await new Promise<Socket>((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port })
        socket.once('connect', () => resolve(socket))
        socket.once('error', reject)
      })
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error('Pi manager did not start')
}

function sessionId(response: ManagerResponse): string {
  if (!isObject(response.data) || typeof response.data.id !== 'string') throw new Error('Invalid session response')
  return response.data.id
}

function isManagerResponse(value: unknown): value is ManagerResponse {
  return isObject(value) && value.kind === 'response' && typeof value.id === 'string' && typeof value.ok === 'boolean'
}

function isManagerEvent(value: unknown): value is ManagerEvent {
  return isObject(value) && value.kind === 'event' && typeof value.event === 'string' && typeof value.sessionId === 'string'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function once(process: ReturnType<typeof spawn>, event: 'exit'): Promise<void> {
  return new Promise((resolve) => process.once(event, () => resolve()))
}
