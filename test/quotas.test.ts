import assert from 'node:assert/strict'
import test from 'node:test'
import {
  glmBusinessError,
  parseCopilotUsage,
  parseGlmResets,
  parseGlmUsage,
  parseOpenAiResetCredits,
  parseOpenAiResetSummary,
  parseOpenAiResets,
  parseOpenAiUsage,
} from '../shared/quota-parsers.ts'
import { quotaRefreshAllowed } from '../shared/quota-refresh.ts'
import type { ManagerEvent } from '../shared/types.ts'
import { QuotaCache } from '../server/features/quotas/quota-cache.ts'
import { QuotaService } from '../server/features/quotas/quota-service.ts'
import type { ManagerClient } from '../server/manager-client.ts'
import {
  copilotPeriodProgress,
  glmPeakDay,
  quotaPeriodProgress,
  quotaProviderForModel,
  quotaUsagePace,
  quotaUsagePaceBands,
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

test('reads banked Codex resets from the usage and credit responses', () => {
  assert.deepEqual(
    parseOpenAiResets({ rate_limit_reset_credits: { available_count: 2 } }),
    { availableCount: 2 },
  )
  assert.deepEqual(parseOpenAiResets({}), undefined)
  assert.deepEqual(
    parseOpenAiResetCredits({
      credits: [
        { id: 'a', status: 'redeemed' },
        {
          id: 'b',
          status: 'available',
          expires_at: '2030-01-01T00:00:00Z',
        },
        { id: 'c', status: 'available' },
        { status: 'available' },
      ],
    }),
    [
      { id: 'b', expiresAt: Date.parse('2030-01-01T00:00:00Z') },
      { id: 'c' },
    ],
  )
})

test('summarizes the reset-credits response with the authoritative count', () => {
  assert.deepEqual(
    parseOpenAiResetSummary({
      available_count: 2,
      credits: [{
        id: 'b',
        status: 'available',
        expires_at: '2030-01-01T00:00:00Z',
      }],
    }),
    { availableCount: 2, nearestExpiry: Date.parse('2030-01-01T00:00:00Z') },
  )
  // The top-level count wins when the credit rows are truncated or absent.
  assert.deepEqual(parseOpenAiResetSummary({ available_count: 0 }), { availableCount: 0 })
  assert.deepEqual(parseOpenAiResetSummary({ credits: [] }), undefined)
  assert.deepEqual(parseOpenAiResetSummary('nope'), undefined)
})

test('reads Z.AI reset cards from the ZCode status response', () => {
  assert.deepEqual(
    parseGlmResets({
      code: 0,
      data: {
        available_five_hour_resets: [],
        available_week_resets: [{ expire_at: 1_800_000_000_000 }, { expire_at: 1_700_000_000_000 }],
      },
    }),
    {
      fiveHour: { availableCount: 0 },
      week: { availableCount: 2, nearestExpiry: 1_700_000_000_000 },
    },
  )
  assert.deepEqual(parseGlmResets({ code: 0, data: {} }), undefined)
  assert.deepEqual(parseGlmResets('nope'), undefined)
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

test('rates quota usage against period progress with early-window grace', () => {
  assert.deepEqual(quotaUsagePaceBands(50), { onTrackLimit: 45, cautionLimit: 60 })
  assert.equal(quotaUsagePace(15, 0), 'on-track')
  assert.equal(quotaUsagePace(16, 0), 'caution')
  assert.equal(quotaUsagePace(41, 0), 'high')
  assert.equal(quotaUsagePace(45, 50), 'on-track')
  assert.equal(quotaUsagePace(55, 50), 'caution')
  assert.equal(quotaUsagePace(61, 50), 'high')
})

test('calculates elapsed Copilot calendar-month periods from reset times', () => {
  const resetsAt = Date.UTC(2030, 1, 1)
  assert.equal(copilotPeriodProgress(resetsAt, Date.UTC(2030, 0, 16, 12)), 50)
  assert.equal(copilotPeriodProgress(resetsAt, Date.UTC(2030, 0, 1)), 0)
  assert.equal(copilotPeriodProgress(resetsAt, resetsAt), 100)
  assert.equal(copilotPeriodProgress(undefined, resetsAt), undefined)
})

test('lays out Z.AI peak pricing across the local day', () => {
  // 2030-01-01 is a Tuesday, so every window below falls on Singapore weekdays.
  const now = Date.UTC(2030, 0, 1, 12)
  const utc = glmPeakDay(now, 0)
  assert.equal(utc.nowFraction, 0.5)
  assert.deepEqual(utc.peakSegments, [{ start: 6 / 24, end: 10 / 24 }])

  const cet = glmPeakDay(now, 60)
  assert.equal(cet.nowFraction, 13 / 24)
  assert.deepEqual(cet.peakSegments, [{ start: 7 / 24, end: 11 / 24 }])

  // UTC-7 places local midnight inside the UTC block, splitting it across the day edges.
  const split = glmPeakDay(Date.UTC(2030, 0, 1, 15), -420)
  assert.deepEqual(split.peakSegments, [{ start: 0, end: 3 / 24 }, { start: 23 / 24, end: 1 }])
})

test('omits Z.AI peak pricing on Singapore weekend days', () => {
  // 2030-01-06 is a Sunday; no block applies in any timezone.
  const sundayUtc = glmPeakDay(Date.UTC(2030, 0, 6, 12), 0)
  assert.deepEqual(sundayUtc.peakSegments, [])
  // Local Saturday in UTC-7 would touch both the Saturday and Sunday blocks.
  const saturdayUtc7 = glmPeakDay(Date.UTC(2030, 0, 5, 20), -420)
  assert.deepEqual(saturdayUtc7.peakSegments, [])
  // Local Sunday evening in UTC-7 reaches Monday's Singapore block.
  const sundayUtc7 = glmPeakDay(Date.UTC(2030, 0, 6, 20), -420)
  assert.deepEqual(sundayUtc7.peakSegments, [{ start: 23 / 24, end: 1 }])
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
    glm: {
      data: [
        { kind: 'session' as const, usedPercent: 30 },
        { kind: 'weekly' as const, usedPercent: 45 },
      ],
      stale: false,
    },
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
    label: `GLM (Z.AI) quota: 5-hour ${formattedPercent.format(30)} % used; weekly ${
      formattedPercent.format(45)
    } % used`,
    secondaryValue: '7d 45%',
    stale: false,
    value: '5h 30%',
  })
})

test('confirms a reset from the extension’s normal refreshed quota report', async () => {
  let service: QuotaService
  const manager = {
    request: async (request: { command?: { message?: unknown } }) => {
      assert.equal(request.command?.message, '/livecraft-quotas-reset')
      setTimeout(() => {
        service.receiveManagerEvent(statusEvent({
          protocol: 'pi-livecraft.quotas',
          version: 1,
          refreshedAt: 200,
          openai: { ok: true, data: [], resets: { availableCount: 1 } },
          copilot: { ok: true, data: [] },
        }))
      }, 0)
      return { type: 'response', command: 'prompt', success: true }
    },
  } as unknown as ManagerClient
  service = new QuotaService(manager)
  service.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 100,
    openai: { ok: true, data: [], resets: { availableCount: 2 } },
    copilot: { ok: true, data: [] },
  }))

  assert.deepEqual(await service.reset('session-id', 'openai'), { ok: true })
})

test('retains a stale provider snapshot when its next refresh fails', () => {
  const cache = new QuotaCache()
  cache.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 100,
    openai: {
      ok: true,
      data: [{ period: '5h', remainingPercent: 80 }],
      resets: { availableCount: 1, nearestExpiry: 1_900_000_000_000 },
    },
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
    // Banked resets survive a failed refresh alongside the stale windows.
    resets: { availableCount: 1, nearestExpiry: 1_900_000_000_000 },
  })
})

test('replaces banked resets on each successful OpenAI refresh', () => {
  const cache = new QuotaCache()
  cache.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 100,
    openai: {
      ok: true,
      data: [],
      resets: { availableCount: 1, nearestExpiry: 1_900_000_000_000 },
    },
    copilot: { ok: true, data: [] },
  }))
  cache.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 200,
    openai: { ok: true, data: [], resets: { availableCount: 0 } },
    copilot: { ok: true, data: [] },
  }))

  assert.deepEqual(cache.snapshot(false).openai.resets, { availableCount: 0 })
})

test('carries Z.AI reset cards through the GLM snapshot', () => {
  const cache = new QuotaCache()
  cache.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 100,
    openai: { ok: true, data: [] },
    copilot: { ok: true, data: [] },
    glm: {
      ok: true,
      data: [{ kind: 'weekly', usedPercent: 42 }],
      resets: { fiveHour: { availableCount: 0 }, week: { availableCount: 1 } },
    },
  }))
  // A failing GLM refresh keeps the cards alongside the stale windows.
  cache.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 200,
    openai: { ok: true, data: [] },
    copilot: { ok: true, data: [] },
    glm: { ok: false, error: 'Z.AI indisponible' },
  }))

  assert.deepEqual(cache.snapshot(false).glm.resets, {
    fiveHour: { availableCount: 0 },
    week: { availableCount: 1 },
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

function statusEvent(report: unknown): ManagerEvent {
  return {
    kind: 'event',
    event: 'pi',
    sessionId: '',
    data: {
      type: 'extension_ui_request',
      method: 'setStatus',
      statusKey: 'pi-livecraft.quotas',
      statusText: JSON.stringify(report),
    },
  }
}
