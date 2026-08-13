import { adminClient, json, preflight } from '../_shared/util.ts'

/**
 * Turning coordinates into a place name.
 *
 * This exists because a browser physically cannot do it. OpenStreetMap's
 * Nominatim requires an identifying User-Agent, and browsers forbid setting
 * that header, so calling Nominatim from the client is both against their
 * usage policy and a good way to get the whole site's traffic banned.
 *
 * It also solves the thing the centroid lookup could not. Central Dhaka has no
 * upazila: the city is thanas, and the open upazila dataset only covers the
 * rural ring. Nearest-centroid therefore labelled Gulshan as "Keraniganj", 10km
 * away. Nominatim knows the real answer, because OSM has the thanas.
 *
 * Three things keep this a good citizen of a volunteer-funded service:
 *
 *   1. Cache first, always. Keyed on coordinates rounded to 3 decimals, about
 *      110 metres, so a whole street shares one entry.
 *   2. One request per second globally, claimed through the database, because
 *      Edge Function instances share no memory.
 *   3. A real User-Agent with a contact address, as their policy asks.
 *
 * When it cannot call out, it degrades rather than fails: the caller still gets
 * the district and upazila from the centroid lookup, which is right everywhere
 * except inside the big cities.
 */

const USER_AGENT =
  'Roktolagbe/1.0 (blood donor directory for Bangladesh; +https://roktolagbe-bd.github.io; roktolagbebd@gmail.com)'

type NominatimAddress = {
  suburb?: string
  neighbourhood?: string
  quarter?: string
  city_district?: string
  town?: string
  city?: string
  municipality?: string
  county?: string
  state_district?: string
  state?: string
}

/**
 * The most useful name for a Bangladeshi address, most specific first.
 *
 * In Dhaka this yields "Gulshan" rather than "Dhaka", which is the entire
 * point: a donor in Gulshan and a donor in Mirpur are 12km apart and should
 * not both read "Dhaka".
 */
function areaLabelFrom(address: NominatimAddress): string | null {
  return (
    address.suburb ??
    address.neighbourhood ??
    address.quarter ??
    address.city_district ??
    address.town ??
    address.municipality ??
    address.city ??
    null
  )
}

/** The name most likely to be one of our 64 districts. */
function districtNameFrom(address: NominatimAddress): string | null {
  return address.state_district ?? address.county ?? address.city ?? null
}

Deno.serve(async (req) => {
  const cors = preflight(req)
  if (cors) return cors

  let lat: number
  let lng: number
  try {
    const body = await req.json()
    lat = Number(body.lat)
    lng = Number(body.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ error: 'lat and lng are required' }, 400)
    }
  } catch {
    return json({ error: 'expected a JSON body' }, 400)
  }

  // Outside Bangladesh there is nothing useful to say, and no reason to spend
  // one of our OSM requests finding that out.
  if (lat < 20.5 || lat > 26.7 || lng < 88.0 || lng > 92.75) {
    return json({ ok: true, outside_country: true })
  }

  const supabase = adminClient()

  try {
    // ---- 1. Cache -------------------------------------------------------
    const { data: cached } = await supabase
      .rpc('geocode_lookup', { in_lat: lat, in_lng: lng })
      .maybeSingle()

    if (cached) {
      const hit = cached as {
        display_name: string | null
        area_label: string | null
        district_id: number | null
        upazila_id: number | null
      }
      return json({
        ok: true,
        source: 'cache',
        area_label: hit.area_label,
        display_name: hit.display_name,
        district_id: hit.district_id,
        upazila_id: hit.upazila_id,
      })
    }

    // ---- 2. Are we allowed to ask OSM right now? ------------------------
    const { data: allowed } = await supabase.rpc('geocode_claim_slot', {
      in_min_interval_ms: 1100,
    })

    if (allowed !== true) {
      // Somebody else asked within the last second. Rather than queue up
      // against a service run on donations, say we do not know. The caller
      // falls back to the centroid lookup, which is instant and offline.
      return json({ ok: true, source: 'throttled', area_label: null })
    }

    // ---- 3. Ask Nominatim ------------------------------------------------
    const url =
      `https://nominatim.openstreetmap.org/reverse?` +
      new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        format: 'jsonv2',
        // 14 is roughly suburb level: the thana in Dhaka, the upazila outside.
        zoom: '14',
        addressdetails: '1',
      })

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        // Bangla names where OSM has them, English otherwise.
        'Accept-Language': 'bn,en',
      },
      signal: AbortSignal.timeout(6000),
    })

    if (!response.ok) {
      return json({ ok: true, source: 'unavailable', area_label: null })
    }

    const result = (await response.json()) as {
      display_name?: string
      address?: NominatimAddress
    }

    const address = result.address ?? {}
    const areaLabel = areaLabelFrom(address)
    const districtName = districtNameFrom(address)

    // ---- 4. Tie the answer back to our own tables ------------------------
    let districtId: number | null = null
    if (districtName) {
      const { data: matched } = await supabase.rpc('district_by_name', {
        in_name: districtName,
      })
      districtId = typeof matched === 'number' ? matched : null
    }

    // ---- 5. Remember it --------------------------------------------------
    await supabase.rpc('geocode_store', {
      in_lat: lat,
      in_lng: lng,
      in_display_name: result.display_name ?? null,
      in_area_label: areaLabel,
      in_district_id: districtId,
      in_upazila_id: null,
      in_raw: address,
    })

    return json({
      ok: true,
      source: 'nominatim',
      area_label: areaLabel,
      display_name: result.display_name ?? null,
      district_id: districtId,
      upazila_id: null,
    })
  } catch (err) {
    console.error('geocode failed', err)
    // Never an error to the caller. A missing area name is a smaller problem
    // than a registration form that will not move on.
    return json({ ok: true, source: 'unavailable', area_label: null })
  }
})
