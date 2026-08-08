import { useCallback, useState } from 'react'

const STORAGE_KEY = 'pi-livecraft.pinned-models'

/** Reads pinned model keys (`provider/id`), tolerating missing, malformed, or legacy values. */
export function readPinnedModels(storage: Storage | undefined = globalThis.localStorage): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const keys = new Set<string>()
    for (const item of parsed) {
      if (typeof item === 'string' && item.length > 0) keys.add(item)
    }
    return [...keys]
  } catch {
    return []
  }
}

/** Persists pinned keys, swallowing storage failures (private browsing, quota). */
export function writePinnedModels(
  ids: string[],
  storage: Storage | undefined = globalThis.localStorage,
): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Pinning stays in-memory for the session when persistence is unavailable.
  }
}

/** Pinned model keys synced to localStorage; `togglePin` adds or removes one key. */
export function usePinnedModels(): [Set<string>, (key: string) => void] {
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(readPinnedModels()))
  const togglePin = useCallback((key: string) => {
    setPinned((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writePinnedModels([...next])
      return next
    })
  }, [])
  return [pinned, togglePin]
}
