import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { cacheGet, cacheSet } from '@/lib/cache'
import type { BloodGroup } from '@/lib/blood'
import type { Coords } from '@/lib/geolocation'

export type DonorResult = {
  id: string
  display_name: string
  blood_group: BloodGroup
  district_id: number | null
  district_en: string | null
  district_bn: string | null
  /** The donor's own neighbourhood name. Free text, one language, may be null. */
  area_name: string | null
  upazila_id: number | null
  upazila_en: string | null
  upazila_bn: string | null
  lat_fuzzed: number | null
  lng_fuzzed: number | null
  verified: boolean
  total_donations: number
  is_available: boolean
  last_donation_month: string | null
  /** Only present when the search had an origin to measure from. */
  distance_km?: number | null
}

export type SearchFilters = {
  bloodGroup: BloodGroup | null
  districtId: number | null
  upazilaId: number | null
  /** When present, results are ranked by real distance from here. */
  origin: Coords | null
  radiusKm: number
}

export type SearchState = {
  results: DonorResult[]
  loading: boolean
  error: 'offline' | 'not_configured' | 'failed' | null
  /** True when what is on screen came from the cache, not the network. */
  fromCache: boolean
  savedAt: Date | null
}

const MAX_RESULTS = 60

/* One cache entry per distinct filter set, so going back to a previous search
   while offline still shows what it showed before. */
function cacheKeyFor(filters: SearchFilters): string {
  const origin = filters.origin
    ? `${filters.origin.lat.toFixed(2)},${filters.origin.lng.toFixed(2)}`
    : 'none'
  return `search.${filters.bloodGroup ?? 'any'}.${filters.districtId ?? 0}.${
    filters.upazilaId ?? 0
  }.${origin}.${filters.radiusKm}`
}

/**
 * Donor search.
 *
 * Two paths into the same shape:
 *
 *   With an origin, it calls nearby_donors(), which measures distance from the
 *   donor's TRUE position so the ranking is honest, and returns only the fuzzed
 *   position so the map cannot give anyone away.
 *
 *   Without one, it reads donors_public, a view that has no contact columns at
 *   all. Ordering then puts available donors first, since distance is unknown.
 *
 * Every result is cached. Someone who searched on the way to the hospital
 * still has the list when the signal drops inside it.
 */
export function useDonorSearch(filters: SearchFilters) {
  const [state, setState] = useState<SearchState>({
    results: [],
    loading: false,
    error: null,
    fromCache: false,
    savedAt: null,
  })

  // Only the newest search may write to state.
  const runId = useRef(0)

  const search = useCallback(async () => {
    const current = ++runId.current
    const key = cacheKeyFor(filters)
    const cached = cacheGet<DonorResult[]>(key)

    setState((s) => ({
      ...s,
      // Show the previous answer for this exact search while the new one
      // loads, rather than blanking the screen.
      results: cached?.data ?? s.results,
      fromCache: Boolean(cached),
      savedAt: cached?.savedAt ?? null,
      loading: true,
      error: null,
    }))

    const pending = getSupabase()
    if (!pending) {
      if (current === runId.current) {
        setState((s) => ({ ...s, loading: false, error: 'not_configured' }))
      }
      return
    }

    try {
      const supabase = await pending
      let rows: DonorResult[] = []

      if (filters.origin && filters.bloodGroup) {
        const { data, error } = await supabase.rpc('nearby_donors', {
          in_blood_group: filters.bloodGroup,
          in_lat: filters.origin.lat,
          in_lng: filters.origin.lng,
          in_radius_km: filters.radiusKm,
          in_max_results: MAX_RESULTS,
        })
        if (error) throw error
        rows = (data ?? []) as DonorResult[]
      } else {
        let query = supabase.from('donors_public').select('*').limit(MAX_RESULTS)
        if (filters.bloodGroup) query = query.eq('blood_group', filters.bloodGroup)
        if (filters.districtId) query = query.eq('district_id', filters.districtId)
        if (filters.upazilaId) query = query.eq('upazila_id', filters.upazilaId)
        // Available donors first, then the most experienced. Without an origin
        // there is no distance to sort by.
        query = query.order('is_available', { ascending: false }).order('total_donations', {
          ascending: false,
        })

        const { data, error } = await query
        if (error) throw error
        rows = (data ?? []) as DonorResult[]
      }

      if (current !== runId.current) return
      cacheSet(key, rows)
      setState({ results: rows, loading: false, error: null, fromCache: false, savedAt: new Date() })
    } catch {
      if (current !== runId.current) return
      const offline = typeof navigator !== 'undefined' && !navigator.onLine
      setState((s) => ({
        ...s,
        loading: false,
        // If there is something cached, an error is context, not a dead end.
        error: offline ? 'offline' : 'failed',
      }))
    }
  }, [filters])

  // Re-run whenever the filters change. The caller owns the filter object.
  useEffect(() => {
    void search()
  }, [search])

  return { ...state, refresh: search }
}
