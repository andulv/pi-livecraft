export interface ReconciliationMeasurement {
  reason: 'visible' | 'reconnect'
  outcome: 'applied' | 'failed' | 'stale'
  hiddenMs?: number
  managerSilenceMs?: number
  piSilenceMs?: number
  hiddenPiEvents?: number
  hiddenSettles?: number
  durationMs: number
  mode: 'delta' | 'full' | 'none'
  messages?: number
  streaming?: boolean
}

/** Keep successful brief tab switches out of the capped persistent client log. */
export function reconciliationLogMessage(
  measurement: ReconciliationMeasurement,
): string | undefined {
  const {
    reason,
    outcome,
    hiddenMs,
    managerSilenceMs,
    piSilenceMs,
    hiddenPiEvents,
    hiddenSettles,
    durationMs,
    mode,
    messages,
    streaming,
  } = measurement
  if (
    reason === 'visible' && (hiddenMs ?? 0) < 10_000 && outcome === 'applied'
    && (mode !== 'delta' || (messages ?? 0) === 0)
  ) return undefined
  return `reason=${reason}; outcome=${outcome}; hiddenMs=${hiddenMs ?? 0}; hiddenPiEvents=${
    hiddenPiEvents ?? 'none'
  }; hiddenSettles=${hiddenSettles ?? 'none'}; managerSilenceMs=${
    managerSilenceMs ?? 'none'
  }; piSilenceMs=${piSilenceMs ?? 'none'}; durationMs=${durationMs}; mode=${mode}; messages=${
    messages ?? 'none'
  }; streaming=${streaming ?? 'unknown'}`
}
