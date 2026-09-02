import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { isObject } from '../shared/is-object.ts'
import {
  glmBusinessError,
  parseCopilotUsage,
  parseGlmUsage,
  parseOpenAiResetCredits,
  parseOpenAiResetSummary,
  parseOpenAiResets,
  parseOpenAiUsage,
} from '../shared/quota-parsers.ts'
import { quotaRefreshAllowed } from '../shared/quota-refresh.ts'
import type {
  CopilotQuotaWindow,
  GlmQuotaWindow,
  OpenAiQuotaReport,
  QuotaProviderReport,
  QuotaReport,
} from '../shared/types.ts'

const statusKey = 'pi-livecraft.quotas'
const timeoutMs = 15_000

/** Registers a silent RPC command that publishes only normalized quotas to Pi Livecraft. */
export default function registerQuotas(pi: ExtensionAPI): void {
  let lastRefreshAt = 0
  let lastReport: QuotaReport | undefined
  let pendingRefresh: Promise<void> | undefined

  /** Deduplicates requests and spaces automatic snapshots without limiting manual clicks. */
  function refresh(ctx: ExtensionContext, automatic: boolean): Promise<void> {
    const now = Date.now()
    if (!quotaRefreshAllowed(lastRefreshAt, automatic, now)) {
      if (lastReport) ctx.ui.setStatus(statusKey, JSON.stringify(lastReport))
      return Promise.resolve()
    }
    lastRefreshAt = now
    pendingRefresh ??= publishQuotaReport(ctx)
      .then((report) => {
        lastReport = report
      })
      .finally(() => {
        pendingRefresh = undefined
      })
    return pendingRefresh
  }

  pi.on('session_start', (_event, ctx) => {
    void refresh(ctx, true)
  })
  pi.registerCommand('livecraft-quotas', {
    description: 'Refresh Pi Livecraft quotas',
    handler: async (args, ctx) => refresh(ctx, args.trim() === 'auto'),
  })
  pi.registerCommand('livecraft-quotas-reset', {
    description: 'Redeem one banked OpenAI Codex rate-limit reset',
    handler: async (_args, ctx) => {
      const result = await consumeOpenAiReset(ctx)
      lastRefreshAt = 0
      await refresh(ctx, false)
      return result
    },
  })
}

async function publishQuotaReport(ctx: ExtensionContext): Promise<QuotaReport> {
  const [openai, copilot, glm] = await Promise.all([
    fetchOpenAiQuotas(ctx),
    fetchCopilotQuotas(ctx),
    fetchGlmQuotas(ctx),
  ])
  const report: QuotaReport = {
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: Date.now(),
    openai,
    copilot,
    glm,
  }
  ctx.ui.setStatus(statusKey, JSON.stringify(report))
  return report
}

/** Resolves OAuth through Pi before calling the Codex usage endpoint. */
async function fetchOpenAiQuotas(ctx: ExtensionContext): Promise<OpenAiQuotaReport> {
  try {
    const credential = await openAiCredential(ctx)
    if (!credential) return failure('OpenAI Codex connection is unavailable in Pi.')
    const data = await fetchJson('https://chatgpt.com/backend-api/wham/usage', credential.headers)
    // The credits endpoint is the authoritative reset source; the usage summary
    // field is not returned for every client, so it only serves as a fallback.
    const detail = await fetchJson(
      'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
      credential.headers,
    )
      .catch(() => undefined)
    const resets = parseOpenAiResetSummary(detail) ?? parseOpenAiResets(data)
    return {
      ok: true,
      data: parseOpenAiUsage(data),
      ...(resets ? { resets } : {}),
    }
  } catch (error) {
    return failure(fetchError(error, 'Unable to fetch OpenAI quotas.'))
  }
}

interface OpenAiCredential {
  accountId: string
  headers: Record<string, string>
}

/** Resolves the ChatGPT OAuth pair used by every Codex WHAM endpoint. */
async function openAiCredential(ctx: ExtensionContext): Promise<OpenAiCredential | undefined> {
  const auth = await ctx.modelRegistry.getProviderAuth('openai-codex')
  const credential = await readCredential(ctx, 'openai-codex')
  const token = auth?.auth.apiKey
  const accountId = stringField(credential, 'accountId')
  if (!token || !accountId) return undefined
  return {
    accountId,
    headers: {
      Authorization: `Bearer ${token}`,
      'ChatGPT-Account-Id': accountId,
      Accept: 'application/json',
      Origin: 'https://chatgpt.com',
      Referer: 'https://chatgpt.com/',
    },
  }
}

/**
 * Redeems the soonest-expiring available banked reset. The consume endpoint is
 * undocumented and irreversible, so one request is made with a fresh idempotency
 * key and no automatic retry; the caller refreshes afterwards either way.
 */
async function consumeOpenAiReset(ctx: ExtensionContext): Promise<string> {
  try {
    const credential = await openAiCredential(ctx)
    if (!credential) return 'error: OpenAI Codex connection is unavailable in Pi.'
    const detail = await fetchJson(
      'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
      credential.headers,
    )
    const credits = parseOpenAiResetCredits(detail).sort(
      (left, right) => (left.expiresAt ?? Infinity) - (right.expiresAt ?? Infinity),
    )
    const credit = credits[0]
    if (!credit) return 'no_credit'
    const response = await fetchJson(
      'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume',
      {
        ...credential.headers,
        'Content-Type': 'application/json',
      },
      {
        method: 'POST',
        body: JSON.stringify({ credit_id: credit.id, redeem_request_id: crypto.randomUUID() }),
      },
    )
    const code = stringField(response, 'code')
    if (code === 'reset' || code === 'already_redeemed') return 'ok'
    if (code === 'no_credit') return 'no_credit'
    if (code === 'nothing_to_reset') return 'nothing_to_reset'
    return `error: Unexpected response from the reset endpoint${code ? ` (${code})` : ''}.`
  } catch (error) {
    return `error: ${fetchError(error, 'Unable to redeem the banked reset.')}`
  }
}

/** Uses the GitHub OAuth token held by Pi, not the Copilot proxy token. */
async function fetchCopilotQuotas(
  ctx: ExtensionContext,
): Promise<QuotaProviderReport<CopilotQuotaWindow>> {
  try {
    await ctx.modelRegistry.getProviderAuth('github-copilot')
    const credential = await readCredential(ctx, 'github-copilot')
    const token = stringField(credential, 'refresh')
    if (!token) return failure('GitHub Copilot connection is unavailable in Pi.')
    const data = await fetchJson('https://api.github.com/copilot_internal/user', {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'GitHubCopilotChat/0.35.0',
      'Editor-Version': 'vscode/1.107.0',
      'Editor-Plugin-Version': 'copilot-chat/0.35.0',
      'Copilot-Integration-Id': 'vscode-chat',
    })
    return { ok: true, data: parseCopilotUsage(data) }
  } catch (error) {
    return failure(fetchError(error, 'Unable to fetch Copilot quotas.'))
  }
}

/**
 * Reads the Z.AI (GLM) provider key and base URL, derives the usage host and Authorization scheme
 * from the base URL, then calls the Coding Plan `usage/quota/limit` endpoint. The base URL is
 * static provider config, so it comes from `getProvider`; the key is resolved via
 * `getApiKeyForProvider`, falling back to the stored credential when resolved auth is unavailable.
 * The China (open.bigmodel.cn) station authenticates with the raw key; z.ai uses `Bearer {key}`.
 */
async function fetchGlmQuotas(
  ctx: ExtensionContext,
): Promise<QuotaProviderReport<GlmQuotaWindow>> {
  try {
    let apiKey = await ctx.modelRegistry.getApiKeyForProvider('zai')
    // env-key providers hold the usable key on the credential itself; read it directly when the
    // resolved auth is unavailable so a transient registry gap does not blank the reading.
    if (!apiKey) apiKey = stringField(await readCredential(ctx, 'zai'), 'key')
    const baseUrl = ctx.modelRegistry.getProvider('zai')?.baseUrl
    if (!apiKey) return failure('Z.AI (GLM) API key is unavailable in Pi.')
    if (!baseUrl) return failure('Z.AI (GLM) endpoint is unavailable in Pi.')
    const origin = new URL(baseUrl).origin
    const authorization = origin.includes('bigmodel.cn') ? apiKey : `Bearer ${apiKey}`
    const data = await fetchJson(`${origin}/api/monitor/usage/quota/limit`, {
      Authorization: authorization,
      Accept: 'application/json',
    })
    const businessError = glmBusinessError(data)
    if (businessError) return failure(businessError)
    return { ok: true, data: parseGlmUsage(data) }
  } catch (error) {
    return failure(fetchError(error, 'Unable to fetch GLM quotas.'))
  }
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** Reads the credential held by the Pi runtime without accessing its storage file. */
async function readCredential(ctx: ExtensionContext, provider: string): Promise<unknown> {
  const registry = ctx.modelRegistry as unknown as {
    runtime?: { credentials?: { read?: (providerId: string) => Promise<unknown> } }
  }
  const read = registry.runtime?.credentials?.read
  return read ? read.call(registry.runtime?.credentials, provider) : undefined
}

function object(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  const field = object(value)?.[key]
  return typeof field === 'string' && field ? field : undefined
}

function failure<T>(error: string): QuotaProviderReport<T> {
  return { ok: false, error }
}

function fetchError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'The quota request timed out.'
  if (error instanceof Error && /^HTTP \d{3}$/.test(error.message))
    return `${fallback} (${error.message})`
  return fallback
}
