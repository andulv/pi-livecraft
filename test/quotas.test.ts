import assert from 'node:assert/strict'
import test from 'node:test'
import {
  glmBusinessError,
  parseCopilotUsage,
  parseGlmUsage,
  parseOpenAiUsage,
} from '../shared/quota-parsers.ts'
import { quotaRefreshAllowed } from '../shared/quota-refresh.ts'
import { QuotaCache } from '../server/features/quotas/quota-cache.ts'
import {
  quotaPeriodProgress,
  quotaProviderForModel,
  railQuota,
} from '../src/features/quotas/quota-display.ts'

test('normalizes the Codex five-hour and weekly windows', () => {
  assert.deepEqual(
    parseOpenAiUsage({
      rate_limit: {
        primary_window: {
          used_percent: 24.5,
          reset_at: 1_800_000_000,
          limit_window_seconds: 18_000,
        },
        secondary_window: {
          percent_left: 31,
          reset_at: 1_900_000_000,
          limit_window_seconds: 604_800,
        },
      },
    }),
    [
      { period: '5h', remainingPercent: 75.5, resetsAt: 1_800_000_000_000 },
      { period: '7d', remainingPercent: 31, resetsAt: 1_900_000_000_000 },
    ],
  )
})

test('keeps only finite monthly Copilot quotas', () => {
  assert.deepEqual(
    parseCopilotUsage({
      quota_reset_date: '2030-01-01T00:00:00Z',
      quota_snapshots: {
        premium_interactions: { entitlement: 300, remaining: 125, unlimited: false },
        chat: { entitlement: 0, remaining: 0, unlimited: true },
      },
    }),
    [{
      name: 'Premium interactions',
      used: 175,
      limit: 300,
      resetsAt: Date.parse('2030-01-01T00:00:00Z'),
    }],
  )
})

test('extracts GLM Coding Plan session, weekly, and web-search windows', () => {
  assert.deepEqual(
    parseGlmUsage({
      code: 200,
      data: {
        limits: [
          { type: 'TOKENS_LIMIT', unit: 3, percentage: 42, nextResetTime: '2030-01-01T00:00:00Z' },
          { type: 'TOKENS_LIMIT', unit: 6, percentage: 17.5, nextResetTime: 1_900_000_000_000 },
          {
            type: 'TIME_LIMIT',
            currentValue: 12,
            usage: 50,
            nextResetTime: '2030-02-01T00:00:00Z',
          },
          { type: 'OTHER', unit: 9, percentage: 99 },
        ],
      },
    }),
    [
      { kind: 'session', usedPercent: 42, resetsAt: Date.parse('2030-01-01T00:00:00Z') },
      { kind: 'weekly', usedPercent: 17.5, resetsAt: 1_900_000_000_000 },
      { kind: 'web-searches', used: 12, limit: 50, resetsAt: Date.parse('2030-02-01T00:00:00Z') },
    ],
  )
})

test('glmBusinessError surfaces business failures and accepts success envelopes', () => {
  assert.equal(glmBusinessError({ code: 200, data: { limits: [] } }), undefined)
  assert.equal(glmBusinessError({ code: '200', data: {} }), undefined)
  assert.equal(
    glmBusinessError({ code: 401, msg: 'invalid api key' }),
    'Z.AI rejected the quota request: invalid api key.',
  )
  assert.equal(
    glmBusinessError({ success: false, message: 'no coding plan' }),
    'Z.AI rejected the quota request: no coding plan.',
  )
  assert.equal(
    glmBusinessError({ code: '1300', error: 'rate limited' }),
    'Z.AI rejected the quota request: rate limited.',
  )
})

test('throttles automatic quota refreshes for 30 seconds but never manual ones', () => {
  assert.equal(quotaRefreshAllowed(10_000, true, 39_999), false)
  assert.equal(quotaRefreshAllowed(10_000, true, 40_000), true)
  assert.equal(quotaRefreshAllowed(39_999, false, 40_000), true)
})

test('calculates elapsed quota periods from their reset times', () => {
  const now = Date.UTC(2030, 0, 1, 12)
  assert.equal(quotaPeriodProgress('5h', now + 2.5 * 60 * 60 * 1000, now), 50)
  assert.equal(quotaPeriodProgress('7d', now + 3.5 * 24 * 60 * 60 * 1000, now), 50)
  assert.equal(quotaPeriodProgress('session', now + 2.5 * 60 * 60 * 1000, now), 50)
  assert.equal(quotaPeriodProgress('weekly', now + 3.5 * 24 * 60 * 60 * 1000, now), 50)
  assert.equal(quotaPeriodProgress('session', now + 6 * 60 * 60 * 1000, now), 0)
  assert.equal(quotaPeriodProgress('weekly', now - 1, now), 100)
  assert.equal(quotaPeriodProgress('web-searches', now, now), undefined)
  assert.equal(quotaPeriodProgress('session', undefined, now), undefined)
})

test('shows the primary quota for the provider selected by the model', () => {
  const quotas = {
    openai: {
      data: [{ period: '7d' as const, remainingPercent: 20 }, {
        period: '5h' as const,
        remainingPercent: 74.6,
      }],
      stale: false,
    },
    copilot: { data: [{ name: 'Premium interactions', used: 75, limit: 300 }], stale: true },
    glm: { data: [{ kind: 'session' as const, usedPercent: 30 }], stale: false },
    refreshing: false,
    sessionRequired: false,
  }

  assert.equal(quotaProviderForModel('openai-codex'), 'openai')
  assert.equal(quotaProviderForModel('github-copilot'), 'copilot')
  assert.equal(quotaProviderForModel('zai'), 'glm')
  assert.equal(quotaProviderForModel('anthropic'), undefined)
  const formattedPercent = new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 1 })
  assert.deepEqual(railQuota(quotas, 'openai'), {
    label: `OpenAI Codex quota: ${formattedPercent.format(25.4)} % used`,
    stale: false,
    value: '25%',
  })
  assert.deepEqual(railQuota(quotas, 'copilot'), {
    label: `GitHub Copilot quota: ${formattedPercent.format(25)} % used`,
    stale: true,
    value: '25%',
  })
  assert.deepEqual(railQuota(quotas, 'glm'), {
    label: `GLM (Z.AI) quota: ${formattedPercent.format(30)} % used`,
    stale: false,
    value: '30%',
  })
})

test('retains a stale provider snapshot when its next refresh fails', () => {
  const cache = new QuotaCache()
  cache.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 100,
    openai: { ok: true, data: [{ period: '5h', remainingPercent: 80 }] },
    copilot: { ok: true, data: [] },
  }))
  cache.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 200,
    openai: { ok: false, error: 'OpenAI indisponible' },
    copilot: { ok: true, data: [] },
  }))

  assert.deepEqual(cache.snapshot(false).openai, {
    data: [{ period: '5h', remainingPercent: 80 }],
    updatedAt: 100,
    stale: true,
    error: 'OpenAI indisponible',
  })
})

test('parses the GLM quota report alongside OpenAI and Copilot', () => {
  const cache = new QuotaCache()
  cache.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 300,
    openai: { ok: true, data: [] },
    copilot: { ok: true, data: [] },
    glm: {
      ok: true,
      data: [
        { kind: 'session', usedPercent: 30, resetsAt: 1_800_000_000_000 },
        { kind: 'web-searches', used: 5, limit: 50 },
      ],
    },
  }))

  assert.deepEqual(cache.snapshot(false).glm, {
    data: [
      { kind: 'session', usedPercent: 30, resetsAt: 1_800_000_000_000 },
      { kind: 'web-searches', used: 5, limit: 50 },
    ],
    updatedAt: 300,
    stale: false,
  })
})

test('keeps OpenAI and Copilot readings when a report omits the GLM section', () => {
  const cache = new QuotaCache()
  cache.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 100,
    openai: { ok: true, data: [{ period: '5h', remainingPercent: 80 }] },
    copilot: { ok: true, data: [] },
  }))

  assert.deepEqual(cache.snapshot(false).glm, { data: [], stale: false })
  assert.equal(cache.snapshot(false).openai.data[0].remainingPercent, 80)
})

function statusEvent(report: unknown): unknown {
  return {
    event: 'pi',
    data: {
      type: 'extension_ui_request',
      method: 'setStatus',
      statusKey: 'pi-livecraft.quotas',
      statusText: JSON.stringify(report),
    },
  }
}
