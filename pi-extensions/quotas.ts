import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createDecipheriv, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir, platform, userInfo } from 'node:os'
import { join } from 'node:path'
import { isObject } from '../shared/is-object.ts'
import {
  glmBusinessError,
  isOpenAiResetConfirmed,
  parseCopilotUsage,
  parseGlmResets,
  parseGlmUsage,
  parseOpenAiResetCredits,
  parseOpenAiResetSummary,
  parseOpenAiResets,
  parseOpenAiUsage,
} from '../shared/quota-parsers.ts'
import { quotaRefreshAllowed } from '../shared/quota-refresh.ts'
import type {
  CopilotQuotaWindow,
  GlmQuotaReport,
  GlmQuotaResets,
  OpenAiQuotaReport,
  QuotaProviderReport,
  QuotaReport,
  QuotaResetOutcome,
  QuotaResetStatus,
} from '../shared/types.ts'

const statusKey = 'pi-livecraft.quotas'
const resetStatusKey = 'pi-livecraft.quota-reset'
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
  /** Ensures a redemption always receives a report collected after it completed. */
  async function refreshAfterReset(ctx: ExtensionContext): Promise<QuotaReport | undefined> {
    if (pendingRefresh) await pendingRefresh.catch(() => undefined)
    lastRefreshAt = 0
    await refresh(ctx, false)
    return lastReport
  }

  pi.registerCommand('livecraft-quotas-reset', {
    description: 'Redeem one banked OpenAI Codex or Z.AI reset card',
    handler: async (args, ctx) => {
      const command = parseResetCommand(args)
      let result: ResetResult
      if (command.target === 'openai') {
        const attempt = await consumeOpenAiReset(ctx)
        let report: QuotaReport | undefined
        try {
          report = await refreshAfterReset(ctx)
        } catch {
          // A known redemption outcome still reaches the backend if refresh fails.
        }
        result = confirmOpenAiReset(attempt, report)
      } else {
        result = command.target
          ? await consumeGlmReset(command.target)
          : errorReset('Unknown reset target.')
        try {
          await refreshAfterReset(ctx)
        } catch {
          // The result remains useful even when the refreshed provider data is unavailable.
        }
      }
      publishResetStatus(ctx, command.requestId, result)
      return resetResultText(result)
    },
  })
}

type ResetTarget = 'openai' | 'glm five-hour' | 'glm week'

interface ResetCommand {
  target?: ResetTarget
  requestId?: string
}

interface ResetResult {
  outcome: QuotaResetOutcome
  error?: string
}

interface UnconfirmedOpenAiReset {
  outcome: 'unconfirmed'
  previousAvailableCount: number
  error?: string
}

type OpenAiResetResult = ResetResult | UnconfirmedOpenAiReset

/** Splits the optional server correlation flag from the human-facing reset target. */
function parseResetCommand(args: string): ResetCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  const requestId = parts
    .find((part) => part.startsWith('--request-id='))
    ?.slice('--request-id='.length)
  const target = parts.filter((part) => !part.startsWith('--request-id=')).join(' ')
  const command: ResetCommand = target === '' || target === 'openai'
    ? { target: 'openai' }
    : target === 'glm five-hour' || target === 'glm week'
    ? { target }
    : {}
  return validRequestId(requestId) ? { ...command, requestId } : command
}

/** Avoids emitting an unbounded status key for manually typed command arguments. */
function validRequestId(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
}

function errorReset(error: string): ResetResult {
  return { outcome: 'error', error }
}

/** Publishes the result after the post-redemption report so the backend can correlate it. */
function publishResetStatus(
  ctx: ExtensionContext,
  requestId: string | undefined,
  result: ResetResult,
): void {
  if (!requestId) return
  const status: QuotaResetStatus = {
    protocol: 'pi-livecraft.quota-reset',
    version: 1,
    requestId,
    outcome: result.outcome,
    ...(result.error ? { error: result.error } : {}),
  }
  ctx.ui.setStatus(resetStatusKey, JSON.stringify(status))
}

/** Retains the command's textual result for direct interactive Pi use. */
function resetResultText(result: ResetResult): string {
  if (result.outcome === 'ok') return 'ok'
  if (result.outcome === 'no_credit') return 'no_credit'
  if (result.outcome === 'nothing_to_reset') return 'nothing_to_reset'
  return `error: ${result.error ?? 'Unable to redeem the reset.'}`
}

/**
 * A successful consume may have no documented response body. Accept it only if
 * the immediately refreshed authoritative credit count decreased.
 */
function confirmOpenAiReset(
  result: OpenAiResetResult,
  report: QuotaReport | undefined,
): ResetResult {
  if (result.outcome !== 'unconfirmed') return result
  if (isOpenAiResetConfirmed(result.previousAvailableCount, report?.openai))
    return { outcome: 'ok' }
  const reason = result.error
    ? `${result.error} The refreshed quota data could not confirm the reset.`
    : 'The reset endpoint returned an unrecognized response and the refreshed quota data could not confirm the reset.'
  return errorReset(`${reason} Refresh quotas before trying again.`)
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
async function consumeOpenAiReset(ctx: ExtensionContext): Promise<OpenAiResetResult> {
  let credential: OpenAiCredential | undefined
  let detail: unknown
  try {
    credential = await openAiCredential(ctx)
    if (!credential) return errorReset('OpenAI Codex connection is unavailable in Pi.')
    detail = await fetchJson(
      'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
      credential.headers,
    )
  } catch (error) {
    return errorReset(fetchError(error, 'Unable to redeem the banked reset.'))
  }
  const credits = parseOpenAiResetCredits(detail).sort(
    (left, right) => (left.expiresAt ?? Infinity) - (right.expiresAt ?? Infinity),
  )
  const credit = credits[0]
  if (!credit) return { outcome: 'no_credit' }
  const previousAvailableCount = parseOpenAiResetSummary(detail)?.availableCount ?? credits.length
  try {
    // Successful undocumented responses may legitimately have no JSON body.
    const response = await fetchOptionalJson(
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
    if (code === 'reset' || code === 'already_redeemed') return { outcome: 'ok' }
    if (code === 'no_credit') return { outcome: 'no_credit' }
    if (code === 'nothing_to_reset') return { outcome: 'nothing_to_reset' }
    return { outcome: 'unconfirmed', previousAvailableCount }
  } catch (error) {
    // The request may have reached the provider before a transport failure.
    return {
      outcome: 'unconfirmed',
      previousAvailableCount,
      error: fetchError(error, 'Unable to redeem the banked reset.'),
    }
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
async function fetchGlmQuotas(ctx: ExtensionContext): Promise<GlmQuotaReport> {
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
    // Reset cards live in the ZCode account service behind its own credentials;
    // anything missing (sign-in, file, endpoint) just leaves the card info absent.
    const resets = await fetchGlmResets().catch(() => undefined)
    return { ok: true, data: parseGlmUsage(data), ...(resets ? { resets } : {}) }
  } catch (error) {
    return failure(fetchError(error, 'Unable to fetch GLM quotas.'))
  }
}

const zcodeResetBase = 'https://zcode.z.ai/api/v1/coding-plan/reset'

interface ZcodeCredential {
  headers: Record<string, string>
}

/**
 * Reads the ZCode credential store the same way ZCode itself does: values are
 * AES-256-GCM blobs keyed by `ZCODE_CREDENTIAL_SECRET` or a deterministic
 * per-machine fallback. Reset cards require the ZCode sign-in JWT, so the
 * feature stays hidden when the user has not signed in. Tokens are never logged.
 */
async function readZcodeCredential(): Promise<ZcodeCredential | undefined> {
  const file = join(homedir(), '.zcode', 'v2', 'credentials.json')
  let stored: unknown
  try {
    stored = JSON.parse(await readFile(file, 'utf-8'))
  } catch {
    return undefined
  }
  const jwt = decryptZcodeValue(stringField(stored, 'zcodejwttoken'))
  const oauth = decryptZcodeValue(stringField(stored, 'oauth:zai:access_token'))
  if (!jwt || !oauth) return undefined
  return {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'X-Bigmodel-Authorization': oauth,
      'Bigmodel-Target-Type': 'PERSONAL',
    },
  }
}

function decryptZcodeValue(value: string | undefined): string | undefined {
  const prefix = 'enc:v1:'
  if (!value?.startsWith(prefix)) return value || undefined
  const [ivPart, tagPart, dataPart] = value.slice(prefix.length).split('.')
  if (!ivPart || !tagPart || !dataPart) return undefined
  const secret = process.env.ZCODE_CREDENTIAL_SECRET
    ?? `zcode-credential-fallback:${platform()}:${homedir()}:${userInfo().username}`
  const key = createHash('sha256').update(secret).digest()
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, base64UrlToBuffer(ivPart))
    decipher.setAuthTag(base64UrlToBuffer(tagPart))
    return Buffer
      .concat([decipher.update(base64UrlToBuffer(dataPart)), decipher.final()])
      .toString('utf-8')
  } catch {
    return undefined
  }
}

function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** Lists the account's reset cards; absent when ZCode is not signed in. */
async function fetchGlmResets(): Promise<GlmQuotaResets | undefined> {
  const credential = await readZcodeCredential()
  if (!credential) return undefined
  const status = await fetchJson(`${zcodeResetBase}/status`, {
    ...credential.headers,
    Accept: 'application/json',
  })
  return parseGlmResets(status)
}

/**
 * Redeems one Z.AI reset card. Like the Codex path, one request is made with a
 * fresh idempotency key and no automatic retry; the caller refreshes after.
 */
async function consumeGlmReset(
  resetType: 'glm five-hour' | 'glm week',
): Promise<ResetResult> {
  try {
    const credential = await readZcodeCredential()
    if (!credential) return errorReset('Sign in to ZCode to use Z.AI reset cards.')
    const response = await fetchJson(`${zcodeResetBase}/use`, {
      ...credential.headers,
      'Content-Type': 'application/json',
    }, {
      method: 'POST',
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        reset_type: resetType === 'glm week' ? 'WEEK' : 'FIVE_HOUR',
      }),
    })
    const code = numberField(response, 'code')
    if (code === 0) return { outcome: 'ok' }
    const message = stringField(response, 'msg')
    return errorReset(`Z.AI rejected the reset${message ? `: ${message}` : '.'}`)
  } catch (error) {
    return errorReset(fetchError(error, 'Unable to redeem the Z.AI reset card.'))
  }
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit,
): Promise<unknown> {
  return (await fetchResponse(url, headers, init)).json()
}

/** Parses a successful response when present; undocumented consume calls may reply 204. */
async function fetchOptionalJson(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit,
): Promise<unknown> {
  const text = await (await fetchResponse(url, headers, init)).text()
  return text ? JSON.parse(text) : undefined
}

async function fetchResponse(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response
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

function numberField(value: unknown, key: string): number | undefined {
  const field = object(value)?.[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
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
