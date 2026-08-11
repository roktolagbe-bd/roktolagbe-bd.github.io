import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { cacheGet, cacheSet } from '@/lib/cache'
import { BLOOD_GROUPS, isBloodGroup } from '@/lib/blood'
import type { TileDatum } from '@/components/BloodGroupTile'

export type SiteStats = {
  donors: number
  fulfilled: number
  districts: number
  byGroup: TileDatum[]
}

export type StatsState = {
  stats: SiteStats
  loading: boolean
  /** True when the numbers on screen are examples, not real records. */
  sample: boolean
  savedAt: Date | null
}

const CACHE_KEY = 'site-stats'

/**
 * Placeholder shape used before the database exists and whenever the network
 * fails with nothing cached. The tiles need to render something, and an empty
 * grid of zeroes reads as "this project is dead" rather than "still loading".
 * Anywhere these numbers appear, the UI says they are samples.
 */
const SAMPLE: SiteStats = {
  donors: 0,
  fulfilled: 0,
  districts: 64,
  byGroup: BLOOD_GROUPS.map((group) => ({ group, available: 0 })),
}

type StatsRow = { metric: string; value: number }
type GroupRow = { blood_group: string; available: number }

export function useSiteStats(): StatsState {
  const cached = cacheGet<SiteStats>(CACHE_KEY)

  const [state, setState] = useState<StatsState>(() => ({
    stats: cached?.data ?? SAMPLE,
    loading: true,
    sample: !cached,
    savedAt: cached?.savedAt ?? null,
  }))

  useEffect(() => {
    let cancelled = false

    async function load() {
      const pending = getSupabase()
      if (!pending) {
        // No project configured. Keep the sample numbers and stop pretending
        // to load, so the "not connected" banner is the only explanation shown.
        if (!cancelled) setState((s) => ({ ...s, loading: false, sample: true }))
        return
      }

      try {
        const supabase = await pending
        const [totals, groups] = await Promise.all([
          supabase.from('public_stats').select('metric, value'),
          supabase.from('public_group_availability').select('blood_group, available'),
        ])

        if (totals.error) throw totals.error
        if (groups.error) throw groups.error

        const totalsMap = new Map(
          ((totals.data ?? []) as StatsRow[]).map((r) => [r.metric, Number(r.value) || 0]),
        )

        const byGroup: TileDatum[] = BLOOD_GROUPS.map((group) => {
          const row = ((groups.data ?? []) as GroupRow[]).find(
            (g) => isBloodGroup(g.blood_group) && g.blood_group === group,
          )
          return { group, available: Number(row?.available ?? 0) }
        })

        const stats: SiteStats = {
          donors: totalsMap.get('donors_total') ?? 0,
          fulfilled: totalsMap.get('requests_fulfilled') ?? 0,
          districts: totalsMap.get('districts_covered') ?? 0,
          byGroup,
        }

        cacheSet(CACHE_KEY, stats)
        if (!cancelled) setState({ stats, loading: false, sample: false, savedAt: new Date() })
      } catch {
        // Offline, or the tables are not built yet. Whatever was cached stays
        // on screen; the offline banner explains why it might be old.
        if (!cancelled) setState((s) => ({ ...s, loading: false }))
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
