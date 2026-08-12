import { useEffect, useState } from 'react'
import { getSupabase } from './supabase'
import { cacheGet, cacheSet } from './cache'
import type { Coords } from './geolocation'

export type District = {
  id: number
  name_en: string
  name_bn: string
  division_en: string | null
  lat: number
  lng: number
}

export type Upazila = {
  id: number
  district_id: number
  name_en: string
  name_bn: string
  lat: number | null
  lng: number | null
}

export type Hospital = {
  id: string
  name_en: string
  name_bn: string | null
  district_id: number | null
  lat: number | null
  lng: number | null
}

export type Area = {
  district_id: number
  district_en: string
  district_bn: string
  upazila_id: number | null
  upazila_en: string | null
  upazila_bn: string | null
  district_distance_km: number
  upazila_distance_km: number | null
}

/* Places change roughly never, and someone registering on a train should not
   lose the dropdowns when the signal drops. Cached for a week. */
const PLACES_TTL = 7 * 24 * 60 * 60 * 1000

/**
 * Districts and upazilas, loaded once and cached.
 *
 * 64 + 494 rows is about 40kb of JSON. That is a lot on a slow connection, so
 * it is fetched lazily when a form that needs it mounts, never on the landing
 * page, and it survives in localStorage afterwards.
 */
export function usePlaces() {
  const [districts, setDistricts] = useState<District[]>(
    () => cacheGet<District[]>('districts')?.data ?? [],
  )
  const [upazilas, setUpazilas] = useState<Upazila[]>(
    () => cacheGet<Upazila[]>('upazilas')?.data ?? [],
  )
  const [loading, setLoading] = useState(districts.length === 0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const pending = getSupabase()
      if (!pending) {
        if (!cancelled) setLoading(false)
        return
      }

      try {
        const supabase = await pending
        const [d, u] = await Promise.all([
          supabase.from('districts').select('id, name_en, name_bn, division_en, lat, lng').order('name_en'),
          supabase.from('upazilas').select('id, district_id, name_en, name_bn, lat, lng').order('name_en'),
        ])
        if (d.error) throw d.error
        if (u.error) throw u.error
        if (cancelled) return

        const districtRows = (d.data ?? []) as District[]
        const upazilaRows = (u.data ?? []) as Upazila[]
        cacheSet('districts', districtRows, PLACES_TTL)
        cacheSet('upazilas', upazilaRows, PLACES_TTL)
        setDistricts(districtRows)
        setUpazilas(upazilaRows)
        setFailed(false)
      } catch {
        // Whatever was cached stays usable. Only report failure if we have
        // nothing at all to show.
        if (!cancelled) setFailed(districts.length === 0)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // Runs once. districts is only read to decide whether a failure is fatal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { districts, upazilas, loading, failed }
}

export function upazilasOf(upazilas: Upazila[], districtId: number | null): Upazila[] {
  if (!districtId) return []
  return upazilas.filter((u) => u.district_id === districtId)
}

/**
 * Coordinates to a district and upazila, using the nearest seeded centroid.
 *
 * Deliberately not Nominatim. See supabase/migrations/0011_locate_area.sql for
 * why: no third party learns where someone is looking for blood, there is no
 * rate limit to trip during a rush, and it answers instantly.
 *
 * The answer is a suggestion. The caller pre-fills the dropdowns with it and
 * leaves the user free to change them.
 */
export async function locateArea(coords: Coords): Promise<Area | null> {
  const pending = getSupabase()
  if (!pending) return null

  try {
    const supabase = await pending
    const { data, error } = await supabase
      .rpc('locate_area', { in_lat: coords.lat, in_lng: coords.lng })
      .maybeSingle()
    if (error) throw error
    return (data as Area | null) ?? null
  } catch {
    return null
  }
}

/**
 * How far a seeded upazila centroid may be from the user before we stop
 * claiming it is their upazila.
 *
 * This exists because of a real failure. A fix in Gulshan-1, accurate to 74
 * metres, was labelled "Keraniganj": the nearest upazila centroid in Dhaka
 * district, about 10km away. The lookup was not broken. The premise was.
 *
 * Central Dhaka has no upazila at all. The city is divided into thanas
 * (Gulshan, Dhanmondi, Mirpur), and the open upazila dataset contains only the
 * rural ring around it: Dhamrai, Dohar, Keraniganj, Nawabganj, Savar. For the
 * most densely populated area in the country there is no right answer to pick,
 * so the honest behaviour is to pick nothing and say so.
 *
 * 8km is chosen because rural upazilas are roughly 15-25km across, so a
 * centroid within 8km is a defensible claim and anything beyond it is a guess
 * dressed up as an answer.
 */
export const UPAZILA_CONFIDENCE_KM = 8

/** Whether locate_area's upazila guess is close enough to act on. */
export function upazilaIsConfident(area: Area | null): boolean {
  return Boolean(
    area?.upazila_id != null &&
      area.upazila_distance_km != null &&
      area.upazila_distance_km <= UPAZILA_CONFIDENCE_KM,
  )
}

/** Straight-line distance in kilometres. Matches the database's haversine. */
export function distanceKm(a: Coords, b: Coords): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
