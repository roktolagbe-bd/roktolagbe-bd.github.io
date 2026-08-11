/**
 * A tiny localStorage cache with expiry.
 *
 * The point is not speed. The point is that a donor search done on a good
 * connection is still on screen when the connection drops thirty seconds later
 * in a hospital corridor. Showing stale results with an honest "you are
 * offline" banner beats showing a spinner that never resolves.
 */

const PREFIX = 'roktolagbe.cache.'

type Envelope<T> = {
  v: 1
  savedAt: number
  expiresAt: number
  data: T
}

export type Cached<T> = {
  data: T
  savedAt: Date
  stale: boolean
}

/** Six hours. Long enough to survive a hospital visit, short enough to be honest. */
export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000

export function cacheSet<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  const now = Date.now()
  const envelope: Envelope<T> = { v: 1, savedAt: now, expiresAt: now + ttlMs, data }
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(envelope))
  } catch {
    // Quota exceeded or storage blocked. Drop the oldest entries and give up
    // quietly; a missing cache is never worth an error message.
    pruneOldest()
  }
}

/**
 * Reads a cached value. Expired entries are still returned, flagged as stale,
 * because an old answer is more useful than no answer when the user is offline.
 * Callers decide whether to use it.
 */
export function cacheGet<T>(key: string): Cached<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const envelope = JSON.parse(raw) as Envelope<T>
    if (envelope.v !== 1) return null
    return {
      data: envelope.data,
      savedAt: new Date(envelope.savedAt),
      stale: Date.now() > envelope.expiresAt,
    }
  } catch {
    return null
  }
}

export function cacheDelete(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* ignore */
  }
}

function pruneOldest(): void {
  try {
    const entries: Array<{ key: string; savedAt: number }> = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(PREFIX)) continue
      try {
        const envelope = JSON.parse(localStorage.getItem(key) ?? '{}') as Envelope<unknown>
        entries.push({ key, savedAt: envelope.savedAt ?? 0 })
      } catch {
        entries.push({ key, savedAt: 0 })
      }
    }
    entries.sort((a, b) => a.savedAt - b.savedAt)
    for (const entry of entries.slice(0, Math.ceil(entries.length / 2))) {
      localStorage.removeItem(entry.key)
    }
  } catch {
    /* ignore */
  }
}
