import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import test from 'node:test'
import { JsonLineDecoder, encodeJsonLine } from '../server/jsonl.ts'
import { isObject } from '../shared/is-object.ts'
import type { JsonObject } from '../shared/types.ts'

interface DocumentationCase {
  name: string
  prompt: string
  expectedDocuments: string[]
}

interface ToolCallTrace {
  id: string
  name: string
  args: JsonObject
  isError?: boolean
}

interface RoutingScore {
  compliance: boolean
  coverage: number
  ordered: boolean
  routingFirst: boolean
  readDocuments: string[]
}

const documentationCases: DocumentationCase[] = [
  {
    name: 'composer',
    prompt: 'Sans modifier le dépôt, prépare un plan précis pour ajouter un nouveau sélecteur dans la barre du composer.',
    expectedDocuments: [
      'docs/README.md',
      'docs/HOW-TO-COMPOSER.md',
      'src/features/composer/README.md',
    ],
  },
  {
    name: 'settings',
    prompt: 'Sans modifier le dépôt, prépare un plan précis pour ajouter une préférence utilisateur dans un nouvel onglet des réglages.',
    expectedDocuments: [
      'docs/README.md',
      'docs/HOW-TO-SETTINGS.md',
      'src/features/settings/README.md',
    ],
  },
  {
    name: 'manager lifecycle',
    prompt: 'Sans modifier le dépôt, prépare un plan précis pour changer le comportement de redémarrage supervisé du manager.',
    expectedDocuments: [
      'docs/README.md',
      'docs/MANAGER-LIFECYCLE.md',
    ],
  },
  {
    name: 'isolated prompt',
    prompt: 'Sans modifier le dépôt, prépare un plan précis pour ajouter un nouvel usage serveur des prompts Pi isolés.',
    expectedDocuments: [
      'docs/README.md',
      'docs/HOW-TO-RUN-ISOLATED-PROMPT.md',
    ],
  },
]

/** Measures whether successful reads covered the expected documentation in order and began with the index. */
function scoreDocumentationRouting(cwd: string, expectedDocuments: string[], trace: ToolCallTrace[]): RoutingScore {
  const successfulReads = trace
    .filter((call) => call.name === 'read' && call.isError === false && typeof call.args.path === 'string')
    .map((call) => normalizePath(cwd, call.args.path as string))
  const positions = expectedDocuments.map((document) => successfulReads.indexOf(document))
  const coverage = positions.filter((position) => position !== -1).length / expectedDocuments.length
  const ordered = positions.every((position, index) => position !== -1 && (index === 0 || position > positions[index - 1]))
  const firstCall = trace[0]
  const routingFirst = firstCall?.name === 'read'
    && firstCall.isError === false
    && typeof firstCall.args.path === 'string'
    && normalizePath(cwd, firstCall.args.path) === expectedDocuments[0]
  return {
    compliance: coverage === 1 && ordered && routingFirst,
    coverage,
    ordered,
    routingFirst,
    readDocuments: successfulReads,
  }
}

function normalizePath(cwd: string, path: string): string {
  const cleaned = path.startsWith('@') ? path.slice(1) : path
  const absolute = isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned)
  const workspacePath = relative(cwd, absolute)
  return workspacePath.startsWith('..') ? cleaned : workspacePath.split(sep).join('/')
}

function traceRead(path: string, isError = false): ToolCallTrace {
  return { id: path, name: 'read', args: { path }, isError }
}

test('scores documentation coverage, order, and initial routing independently', () => {
  const cwd = process.cwd()
  const expected = ['docs/README.md', 'docs/HOW-TO-COMPOSER.md']

  assert.deepEqual(scoreDocumentationRouting(cwd, expected, expected.map((path) => traceRead(path))), {
    compliance: true,
    coverage: 1,
    ordered: true,
    routingFirst: true,
    readDocuments: expected,
  })

  const wrongOrder = scoreDocumentationRouting(cwd, expected, [...expected].reverse().map((path) => traceRead(path)))
  assert.equal(wrongOrder.coverage, 1)
  assert.equal(wrongOrder.ordered, false)
  assert.equal(wrongOrder.routingFirst, false)

  const sourceFirst = scoreDocumentationRouting(cwd, expected, [
    traceRead('src/App.tsx'),
    ...expected.map((path) => traceRead(path)),
  ])
  assert.equal(sourceFirst.coverage, 1)
  assert.equal(sourceFirst.ordered, true)
  assert.equal(sourceFirst.routingFirst, false)

  const failedGuide = scoreDocumentationRouting(cwd, expected, [traceRead(expected[0]), traceRead(expected[1], true)])
  assert.equal(failedGuide.coverage, 0.5)
  assert.equal(failedGuide.compliance, false)
})

test('evaluates documentation routing with a real read-only Pi agent', { timeout: 60 * 60_000 }, async () => {
  const cwd = process.cwd()
  const repeats = positiveInteger(process.env.PI_DOC_ROUTING_REPEATS, 3)
  const provider = process.env.PI_DOC_ROUTING_PROVIDER ?? 'opencode-go'
  const model = process.env.PI_DOC_ROUTING_MODEL ?? 'deepseek-v4-pro'
  const thinking = process.env.PI_DOC_ROUTING_THINKING ?? 'high'
  const results: Array<{ testCase: DocumentationCase; score: RoutingScore; cost?: number; trace: ToolCallTrace[] }> = []

  console.log(`\nDocumentation routing evaluation: ${provider}/${model}, thinking=${thinking}, repeats=${repeats}`)
  for (const testCase of documentationCases) {
    for (let attempt = 1; attempt <= repeats; attempt += 1) {
      const run = await runReadOnlyPrompt(cwd, testCase.prompt, provider, model, thinking)
      const score = scoreDocumentationRouting(cwd, testCase.expectedDocuments, run.trace)
      results.push({ testCase, score, cost: run.cost, trace: run.trace })
      console.log(`${testCase.name} #${attempt}: compliance=${score.compliance} coverage=${formatRate(score.coverage)} ordered=${score.ordered} routingFirst=${score.routingFirst}`)
      console.log(`  expected: ${testCase.expectedDocuments.join(' -> ')}`)
      console.log(`  tools: ${formatTrace(cwd, run.trace)}`)
    }
  }

  const compliance = results.filter(({ score }) => score.compliance).length / results.length
  const coverage = results.reduce((sum, { score }) => sum + score.coverage, 0) / results.length
  const ordered = results.filter(({ score }) => score.ordered).length / results.length
  const routingFirst = results.filter(({ score }) => score.routingFirst).length / results.length
  const totalCost = results.reduce((sum, result) => sum + (result.cost ?? 0), 0)
  console.log(`Summary: compliance=${formatRate(compliance)} coverage=${formatRate(coverage)} ordered=${formatRate(ordered)} routingFirst=${formatRate(routingFirst)} cost=$${totalCost.toFixed(4)}`)
})

/** Runs one ephemeral Pi prompt with mutation-capable tools disabled and captures ordered tool events. */
async function runReadOnlyPrompt(cwd: string, prompt: string, provider: string, model: string, thinking: string): Promise<{ cost?: number; trace: ToolCallTrace[] }> {
  const pi = new RpcEvaluationProcess(cwd, provider, model, thinking)
  try {
    await Promise.all([
      pi.request({ type: 'prompt', message: prompt }, 10 * 60_000),
      pi.waitForEvent('agent_settled', 10 * 60_000),
    ])
    let cost: number | undefined
    try {
      const stats = await pi.request({ type: 'get_session_stats' })
      if (isObject(stats.data) && typeof stats.data.cost === 'number') cost = stats.data.cost
    } catch {
      // Cost metadata is optional and does not affect the routing evaluation.
    }
    return { cost, trace: pi.trace }
  } finally {
    await pi.terminate()
  }
}

class RpcEvaluationProcess {
  readonly trace: ToolCallTrace[] = []
  readonly #child: ChildProcessWithoutNullStreams
  readonly #events = new EventEmitter()
  readonly #pending = new Map<string, { reject: (error: Error) => void; resolve: (value: JsonObject) => void; timeout: NodeJS.Timeout }>()
  readonly #exited: Promise<void>
  #nextRequestId = 0
  #stderr = ''

  constructor(cwd: string, provider: string, model: string, thinking: string) {
    this.#child = spawn('pi', [
      '--mode', 'rpc',
      '--no-session',
      '--provider', provider,
      '--model', model,
      '--thinking', thinking,
      '--tools', 'read,grep,find,ls',
      '--no-extensions',
    ], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.#exited = new Promise((resolveExit) => this.#child.once('close', () => resolveExit()))
    const decoder = new JsonLineDecoder((value) => this.#receive(value))
    this.#child.stdout.on('data', (chunk: Buffer) => decoder.push(chunk))
    this.#child.stdout.on('end', () => decoder.end())
    this.#child.stderr.on('data', (chunk: Buffer) => { this.#stderr = `${this.#stderr}${chunk.toString('utf8')}`.slice(-8_192) })
    this.#child.on('error', (error) => this.#fail(error))
    this.#child.on('close', (code, signal) => this.#fail(new Error(`Pi exited (${signal ?? code ?? 'unknown'}): ${this.#stderr.trim()}`)))
  }

  request(command: JsonObject, timeoutMs = 30_000): Promise<JsonObject> {
    const id = `doc-eval-${this.#nextRequestId += 1}`
    return new Promise((resolveRequest, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`Pi RPC command timed out: ${String(command.type)}`))
      }, timeoutMs)
      this.#pending.set(id, { reject, resolve: resolveRequest, timeout })
      this.#child.stdin.write(encodeJsonLine({ ...command, id }))
    })
  }

  waitForEvent(type: string, timeoutMs: number): Promise<void> {
    return new Promise((resolveEvent, reject) => {
      const timeout = setTimeout(() => finish(new Error(`Pi event timed out: ${type}`)), timeoutMs)
      const onEvent = (event: JsonObject): void => {
        if (event.type === type) finish()
      }
      const onClose = (): void => finish(new Error(`Pi exited before event ${type}: ${this.#stderr.trim()}`))
      const finish = (error?: Error): void => {
        clearTimeout(timeout)
        this.#events.off('event', onEvent)
        this.#child.off('close', onClose)
        if (error) reject(error)
        else resolveEvent()
      }
      this.#events.on('event', onEvent)
      this.#child.once('close', onClose)
    })
  }

  async terminate(): Promise<void> {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return
    this.#child.kill('SIGTERM')
    await Promise.race([this.#exited, new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 2_000))])
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGKILL')
      await this.#exited
    }
  }

  #receive(value: unknown): void {
    if (!isObject(value)) return
    if (value.type === 'response' && typeof value.id === 'string') {
      const pending = this.#pending.get(value.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.#pending.delete(value.id)
      if (value.success === false) pending.reject(new Error(String(value.error ?? 'Pi RPC command failed')))
      else pending.resolve(value)
      return
    }
    if (value.type === 'tool_execution_start' && typeof value.toolCallId === 'string' && typeof value.toolName === 'string' && isObject(value.args)) {
      this.trace.push({ id: value.toolCallId, name: value.toolName, args: value.args })
    }
    if (value.type === 'tool_execution_end' && typeof value.toolCallId === 'string') {
      const call = this.trace.find((entry) => entry.id === value.toolCallId)
      if (call) call.isError = value.isError === true
    }
    this.#events.emit('event', value)
  }

  #fail(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatTrace(cwd: string, trace: ToolCallTrace[]): string {
  return trace.map((call) => {
    const path = typeof call.args.path === 'string' ? `(${normalizePath(cwd, call.args.path)})` : ''
    return `${call.name}${path}${call.isError ? '!' : ''}`
  }).join(' -> ') || '(none)'
}
