import type { QuotaSnapshot } from '../../../shared/types.ts'

export type QuotaProvider = 'openai' | 'copilot' | 'glm'

export interface RailQuota {
  label: string
  stale: boolean
  value: string
}

export function quotaProviderForModel(provider: unknown): QuotaProvider | undefined {
  if (provider === 'openai-codex') return 'openai'
  if (provider === 'github-copilot') return 'copilot'
  if (provider === 'zai') return 'glm'
  return undefined
}

/** Summarizes the main window of the active provider for the compact rail. */
export function railQuota(
  quotas: QuotaSnapshot | null,
  provider: QuotaProvider | undefined,
): RailQuota | undefined {
  if (!quotas || !provider) return undefined
  if (provider === 'openai') {
    const window = quotas.openai.data.find(({ period }) => period === '5h') ?? quotas.openai.data[0]
    return window && {
      label: `OpenAI Codex quota: ${formatPercent(window.remainingPercent)} remaining`,
      stale: quotas.openai.stale,
      value: `${Math.round(window.remainingPercent)}%`,
    }
  }

  if (provider === 'glm') {
    const window = quotas.glm.data.find(({ kind }) => kind === 'session') ?? quotas.glm.data[0]
    if (!window || window.usedPercent === undefined) return undefined
    const remainingPercent = 100 - window.usedPercent
    return {
      label: `GLM (Z.AI) quota: ${formatPercent(remainingPercent)} remaining`,
      stale: quotas.glm.stale,
      value: `${Math.round(Math.max(0, Math.min(100, remainingPercent)))}%`,
    }
  }

  const window = quotas.copilot.data[0]
  if (!window) return undefined
  const remainingPercent = (window.limit - window.used) / window.limit * 100
  return {
    label: `GitHub Copilot quota: ${formatPercent(remainingPercent)} remaining`,
    stale: quotas.copilot.stale,
    value: `${Math.round(Math.max(0, Math.min(100, remainingPercent)))}%`,
  }
}

function formatPercent(value: number): string {
  return `${
    new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 1 }).format(Math
      .max(0, Math.min(100, value)))
  } %`
}
