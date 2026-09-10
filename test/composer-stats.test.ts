import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSessionStats, formatTokens } from '../src/features/composer/composer-utils.ts'

test('abbreviates large token totals without long thousands values', () => {
  assert.equal(formatTokens(52_828_000), '52.8m')
})

test('formats cumulative session token and activity metrics', () => {
  const formatted = formatSessionStats({
    tokens: { input: 1_000, cacheRead: 9_000, cacheWrite: 0, output: 3_000 },
    userMessages: 7,
    assistantMessages: 8,
    toolCalls: 22,
    cost: 1.25,
    contextUsage: { tokens: 12_000, contextWindow: 100_000, percent: 12 },
  })

  assert.deepEqual(formatted, {
    assistantMessages: '8',
    cachePercent: '90%',
    cost: '$1.25',
    contextClass: '',
    contextTokens: '12k/100k',
    contextPercent: '12%',
    contextPercentValue: 12,
    inputTokens: '10k',
    outputTokens: '3k',
    toolCalls: '22',
    userMessages: '7',
  })
})

test('uses gradual context pressure colors at the defined thresholds', () => {
  const expectations: Array<[number, string]> = [
    [19.9, ''],
    [20, 'context-warning-weak'],
    [39.9, 'context-warning-weak'],
    [40, 'context-warning'],
    [59.9, 'context-warning'],
    [60, 'context-warning-strong'],
    [79.9, 'context-warning-strong'],
    [80, 'context-warning-critical'],
    [89.9, 'context-warning-critical'],
    [90, 'context-danger'],
  ]

  for (const [percent, expectedClass] of expectations) {
    assert.equal(
      formatSessionStats({ contextUsage: { tokens: percent, contextWindow: 100, percent } })
        .contextClass,
      expectedClass,
      `${percent}%`,
    )
  }
})

test('shows unavailable session metrics without producing invalid percentages', () => {
  const formatted = formatSessionStats(null)

  assert.equal(formatted.inputTokens, '—')
  assert.equal(formatted.outputTokens, '—')
  assert.equal(formatted.cachePercent, '—')
  assert.equal(formatted.userMessages, '—')
  assert.equal(formatted.assistantMessages, '—')
  assert.equal(formatted.toolCalls, '—')
})
