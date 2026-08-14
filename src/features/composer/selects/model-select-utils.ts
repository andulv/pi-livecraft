import type { JsonObject } from '../../../../shared/types.ts'
import { isObject } from '../../../../shared/is-object.ts'

/** A normalized model row derived from Pi's available-model entry. */
export interface ModelOption {
  key: string
  id: string
  provider: string
  name: string
  cost: { input: number; output: number } | null
  /** Coding-plan / subscription models carry all-zero cost, so per-token pricing does not apply. */
  subscription: boolean
}

export interface ModelGroup {
  key: string
  label: string
  models: ModelOption[]
}

export type ModelCostLabel =
  | { kind: 'paid'; text: string }
  | { kind: 'covered'; text: string }
  | { kind: 'subscription' }
  | null

const PROVIDER_NAMES: Record<string, string> = {
  'amazon-bedrock': 'Amazon Bedrock',
  anthropic: 'Anthropic',
  'azure-openai-responses': 'Azure OpenAI',
  cerebras: 'Cerebras',
  'cloudflare-ai-gateway': 'Cloudflare',
  'cloudflare-workers-ai': 'Cloudflare',
  deepseek: 'DeepSeek',
  fireworks: 'Fireworks',
  'github-copilot': 'GitHub Copilot',
  'google-generative-ai': 'Google',
  'google-vertex': 'Google Vertex',
  groq: 'Groq',
  huggingface: 'Hugging Face',
  'kimi-coding': 'Kimi',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax (China)',
  mistral: 'Mistral',
  moonshotai: 'Moonshot',
  'moonshotai-cn': 'Moonshot (China)',
  nvidia: 'NVIDIA',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go',
  openrouter: 'OpenRouter',
  'qwen-token-plan': 'Qwen',
  'qwen-token-plan-cn': 'Qwen (China)',
  together: 'Together',
  'vercel-ai-gateway': 'Vercel',
  xai: 'xAI',
  xiaomi: 'Xiaomi',
  zai: 'Z.AI',
  'zai-coding-cn': 'Z.AI (China)',
}

/** Friendly provider label, falling back to a title-cased id for unknown providers. */
export function providerDisplayName(provider: string): string {
  const known = PROVIDER_NAMES[provider]
  if (known) return known
  return provider
    .split(/[-_.]/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}

/** Normalizes a Pi model entry into a row, or `undefined` when it lacks an id/provider. */
export function toModelOption(model: JsonObject): ModelOption | undefined {
  if (!isObject(model) || typeof model.id !== 'string' || typeof model.provider !== 'string') {
    return undefined
  }
  const cost = readCost(model.cost)
  return {
    key: `${model.provider}/${model.id}`,
    id: model.id,
    provider: model.provider,
    name: typeof model.name === 'string' && model.name ? model.name : model.id,
    cost,
    subscription: cost !== null && cost.input === 0 && cost.output === 0,
  }
}

/** Pinned models first (in pin order), then the remaining models grouped by provider. */
export function groupModelOptions(
  models: ModelOption[],
  pinned: ReadonlySet<string>,
): ModelGroup[] {
  const groups: ModelGroup[] = []
  const byProvider = new Map<string, ModelGroup>()

  const favorites = [...pinned].flatMap((key) => {
    const match = models.find((model) => model.key === key)
    return match ? [match] : []
  })
  if (favorites.length > 0)
    groups.push({ key: '__favorites', label: 'Favorites', models: favorites })

  for (const model of models) {
    if (pinned.has(model.key)) continue
    let group = byProvider.get(model.provider)
    if (!group) {
      group = { key: model.provider, label: providerDisplayName(model.provider), models: [] }
      byProvider.set(model.provider, group)
      groups.push(group)
    }
    group.models.push(model)
  }

  return groups
}

/** Providers whose models are billed through a coding-plan subscription rather than per token. */
const subscriptionProviders = new Set([
  'github-copilot',
  'openai-codex',
  'zai',
  'zai-coding-cn',
])

/** Per-token price for paid models; a subscription marker when cost is all-zero; `null` otherwise. */
export function modelCostLabel(option: ModelOption): ModelCostLabel {
  if (option.cost === null) return null
  if (option.subscription) return { kind: 'subscription' }
  const plan = subscriptionProviders.has(option.provider)
  return {
    kind: plan ? 'covered' : 'paid',
    text: `$${formatPrice(option.cost.input)} in · $${formatPrice(option.cost.output)} out`,
  }
}

function readCost(cost: unknown): { input: number; output: number } | null {
  if (!isObject(cost)) return null
  const input = asFiniteNumber(cost.input)
  const output = asFiniteNumber(cost.output)
  if (input === undefined || output === undefined) return null
  return { input, output }
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function formatPrice(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
