#!/usr/bin/env node
/**
 * Generates supabase/seed/001_districts.sql and 002_upazilas.sql.
 *
 * Run it with:   node scripts/build-geo-seed.mjs
 *
 * Why this script exists
 * ----------------------
 * Nobody should type 494 upazila names and coordinates by hand, and nobody
 * should trust a machine that made them up. This pulls names from a published
 * open dataset and derives every upazila centroid from its actual boundary
 * polygon, so every coordinate traces back to a source.
 *
 * All three inputs come from ONE repository on purpose. An earlier version of
 * this script joined two different published datasets on their numeric ids and
 * produced silently wrong output: the id spaces disagree, so Debidwar in
 * Cumilla was handed a polygon 150km away in Barishal. Nothing crashed and the
 * SQL looked perfect. Mixing sources by id is the trap here; the sanity check
 * at the end of this file exists to make that failure loud.
 *
 * Source, ODbL, derived from OpenStreetMap:
 *   ifahimreza/bangladesh-geojson
 *
 * ODbL is share-alike. The generated seed files are a derived database and
 * carry the same licence and attribution. See supabase/seed/README.md.
 *
 * Requires network access. Output is committed, so a normal build never runs it.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://raw.githubusercontent.com/ifahimreza/bangladesh-geojson/master/src/data'
const SOURCES = {
  divisions: `${BASE}/bd-divisions.json`,
  districts: `${BASE}/bd-districts.json`,
  upazilas: `${BASE}/bd-upazilas.json`,
  boundaries: `${BASE}/bangladesh.geojson`,
}

/* Anything outside this box is not in Bangladesh and is a bug, not a place. */
const BBOX = { minLon: 88.0, maxLon: 92.75, minLat: 20.5, maxLat: 26.7 }

/* An upazila centroid further than this from its own district centroid is a
   mismatch, not a big upazila. Bangladesh's largest district is comfortably
   inside this radius. */
const MAX_KM_FROM_DISTRICT = 120

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

/** Each file wraps its rows in a single named key, e.g. { districts: [...] }. */
const unwrap = (d) => {
  if (Array.isArray(d)) return d.find((x) => x && x.data)?.data ?? d
  const firstArray = Object.values(d).find(Array.isArray)
  if (!firstArray) throw new Error(`No row array found in ${JSON.stringify(Object.keys(d))}`)
  return firstArray
}

/**
 * Area-weighted centroid of a GeoJSON Polygon or MultiPolygon.
 *
 * Planar shoelace on raw degrees. Across a single upazila at Bangladesh's
 * latitude the distortion is far below the precision this point is used at:
 * centring a map, and a rough fallback location. It is never used for distance
 * maths, which runs off real donor coordinates with haversine.
 *
 * Interior rings are subtracted, so a boundary with a hole still lands right.
 */
function centroidOf(geometry) {
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : []

  let totalArea = 0
  let sumX = 0
  let sumY = 0
  let fallbackX = 0
  let fallbackY = 0
  let vertexCount = 0

  for (const rings of polygons) {
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r]
      const sign = r === 0 ? 1 : -1 // outer ring adds, every hole takes away

      let a = 0
      let cx = 0
      let cy = 0

      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j]
        const [x2, y2] = ring[i]
        const cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
        fallbackX += x2
        fallbackY += y2
        vertexCount++
      }

      a /= 2
      if (a !== 0) {
        totalArea += sign * a
        sumX += sign * (cx / 6)
        sumY += sign * (cy / 6)
      }
    }
  }

  if (totalArea === 0) {
    if (!vertexCount) return null
    return { lat: fallbackY / vertexCount, lng: fallbackX / vertexCount }
  }
  return { lat: sumY / totalArea, lng: sumX / totalArea }
}

const inBangladesh = (p) =>
  p &&
  p.lng >= BBOX.minLon &&
  p.lng <= BBOX.maxLon &&
  p.lat >= BBOX.minLat &&
  p.lat <= BBOX.maxLat

/** Haversine, kilometres. Same formula the database uses for matching. */
function distanceKm(a, b) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/upazill?a/g, '')
    .replace(/[^a-z]/g, '')

/** Rows come from an external dataset, so quote everything properly. */
const q = (value) => (value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`)
const num = (value, dp = 6) =>
  value == null || Number.isNaN(value) ? 'NULL' : Number(value).toFixed(dp)

const HEADER = (title, extra) => `-- ${title}
--
-- GENERATED FILE. Do not edit by hand.
-- Regenerate with:  node scripts/build-geo-seed.mjs
--
-- Source: ifahimreza/bangladesh-geojson, ODbL, derived from OpenStreetMap.
-- ODbL is share-alike: this derived data carries the same licence.
-- Corrections are welcome and are a one line pull request.
${extra ? `--\n${extra}\n` : ''}
`

async function main() {
  console.log('Fetching sources...')
  const [divisionsRaw, districtsRaw, upazilasRaw, boundaries] = await Promise.all([
    getJson(SOURCES.divisions),
    getJson(SOURCES.districts),
    getJson(SOURCES.upazilas),
    getJson(SOURCES.boundaries),
  ])

  const divisions = unwrap(divisionsRaw)
  const districts = unwrap(districtsRaw)
  const upazilas = unwrap(upazilasRaw)

  console.log(
    `divisions=${divisions.length} districts=${districts.length} upazilas=${upazilas.length} features=${boundaries.features.length}`,
  )

  const divisionById = new Map(divisions.map((d) => [String(d.id), d]))

  /* ---- Districts --------------------------------------------------------- */
  const districtRows = districts.map((d) => {
    // This dataset spells the longitude column "long", not "lon".
    const point = { lat: Number(d.lat), lng: Number(d.long ?? d.lon ?? d.lng) }
    if (!inBangladesh(point)) {
      throw new Error(`District ${d.name} centroid is outside Bangladesh: ${JSON.stringify(point)}`)
    }
    return {
      id: Number(d.id),
      en: d.name,
      bn: d.bn_name,
      division: divisionById.get(String(d.division_id)),
      ...point,
    }
  })
  const districtById = new Map(districtRows.map((d) => [d.id, d]))

  /* ---- Upazila centroids from boundary polygons --------------------------
   * The boundary file and the name list come from the same repository, so
   * upazila_id is the same key in both. No cross-source id joins.
   * ---------------------------------------------------------------------- */
  const byId = new Map()
  const candidatesByName = new Map()
  const outsideCountry = []

  for (const feature of boundaries.features) {
    if (!feature.geometry) continue
    const c = centroidOf(feature.geometry)
    if (!c) continue

    const props = feature.properties ?? {}
    if (!inBangladesh(c)) {
      outsideCountry.push(`${props.name} -> ${c.lat},${c.lng}`)
      continue
    }

    // Some upazilas appear as several features (enclaves, river splits).
    // Keep the largest ring set: that is the body of the upazila.
    const size = JSON.stringify(feature.geometry).length
    const put = (map, key) => {
      if (!key) return
      const existing = map.get(key)
      if (!existing || size > existing.size) map.set(key, { ...c, size })
    }

    put(byId, String(props.upazila_id ?? ''))

    // 118 features carry a real name but blank ids. Rather than demand that a
    // name be unique countrywide, keep every candidate and let the district
    // centroid pick between them. That is what actually distinguishes the
    // Companiganj in Noakhali from the Companiganj in Sylhet.
    const key = norm(props.name)
    if (key) {
      if (!candidatesByName.has(key)) candidatesByName.set(key, [])
      candidatesByName.get(key).push({ ...c, size })
    }
  }

  /**
   * Levenshtein distance. Used only as a last resort, and only for candidates
   * that already pass the district guard, so a wrong match cannot place an
   * upazila in the wrong part of the country. English transliterations of
   * Bangla names vary a lot: Anwara/Anowara, Ghior/Gior, Pangsha/Pangsa.
   */
  function editDistance(a, b) {
    if (a === b) return 0
    const m = a.length
    const n = b.length
    if (!m || !n) return m || n
    let prev = Array.from({ length: n + 1 }, (_, i) => i)
    for (let i = 1; i <= m; i++) {
      const cur = [i]
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      }
      prev = cur
    }
    return prev[n]
  }

  const allNamed = [...candidatesByName.entries()].flatMap(([name, points]) =>
    points.map((p) => ({ name, point: p })),
  )

  const counts = { id: 0, name: 0, fuzzy: 0, none: 0, rejected: 0 }
  const rejected = []
  const fuzzyLog = []

  const upazilaRows = upazilas.map((u) => {
    const districtId = Number(u.district_id)
    const district = districtById.get(districtId)

    /* The guard that matters. A centroid far from its own district centre
       means the join went wrong, which is exactly how an earlier version of
       this script failed silently. Never seed a point that fails it. */
    const near = (p) => !district || distanceKm(p, district) <= MAX_KM_FROM_DISTRICT

    const idMatch = byId.get(String(u.id))
    let c = null
    let how = null

    if (idMatch && near(idMatch)) {
      c = idMatch
      how = 'id'
      counts.id++
    } else {
      if (idMatch && district) {
        rejected.push(
          `${u.name} (${u.id}) in ${district.en}: id match was ${distanceKm(idMatch, district).toFixed(0)}km away, discarded`,
        )
        counts.rejected++
      }
      // Among same-named polygons, take the one nearest this upazila's own
      // district centre. Ties across the country resolve correctly this way.
      const candidates = (candidatesByName.get(norm(u.name)) ?? []).filter(near)
      if (candidates.length && district) {
        candidates.sort((a, b) => distanceKm(a, district) - distanceKm(b, district))
        c = candidates[0]
        how = 'name'
        counts.name++
      } else if (candidates.length === 1) {
        c = candidates[0]
        how = 'name'
        counts.name++
      }

      // Last resort: nearest spelling, but only among polygons already inside
      // this district's radius.
      if (!c && district) {
        const target = norm(u.name)
        const limit = Math.min(3, Math.max(1, Math.floor(target.length / 4)))
        const scored = allNamed
          .filter((entry) => near(entry.point))
          .map((entry) => ({ ...entry, score: editDistance(target, entry.name) }))
          .filter((entry) => entry.score <= limit)
          .sort((a, b) => a.score - b.score || distanceKm(a.point, district) - distanceKm(b.point, district))

        if (scored.length) {
          c = scored[0].point
          how = 'fuzzy'
          counts.fuzzy++
          fuzzyLog.push(
            `${u.name} (${district.en}) -> ${scored[0].name} [distance ${scored[0].score}, ${distanceKm(c, district).toFixed(0)}km from district centre]`,
          )
        }
      }
    }

    if (!c) counts.none++
    void how

    return {
      id: Number(u.id),
      districtId,
      en: u.name,
      bn: u.bn_name,
      lat: c?.lat ?? null,
      lng: c?.lng ?? null,
    }
  })

  console.log(
    `matched by id=${counts.id} by name=${counts.name} by nearest spelling=${counts.fuzzy} unmatched=${counts.none}`,
  )
  if (fuzzyLog.length) {
    console.log(`matched on spelling, all inside their district (audit these):\n  ${fuzzyLog.join('\n  ')}`)
  }
  if (outsideCountry.length) {
    console.log(`outside Bangladesh, skipped:\n  ${outsideCountry.join('\n  ')}`)
  }
  if (rejected.length) {
    console.log(`REJECTED, too far from their district:\n  ${rejected.join('\n  ')}`)
  }

  const missing = upazilaRows.filter((u) => u.lat == null)
  console.log(`upazila centroids: ${upazilaRows.length - missing.length}/${upazilaRows.length}`)
  if (missing.length) {
    console.log(`no polygon:\n  ${missing.map((m) => `${m.en} (${m.id})`).join('\n  ')}`)
  }

  /* ---- Write SQL --------------------------------------------------------- */
  const seedDir = join(process.cwd(), 'supabase', 'seed')
  mkdirSync(seedDir, { recursive: true })

  const districtSql =
    HEADER(`Seed: all ${districtRows.length} districts of Bangladesh`) +
    `insert into public.districts (id, name_en, name_bn, division_en, division_bn, lat, lng) values\n` +
    districtRows
      .map(
        (d) =>
          `  (${d.id}, ${q(d.en)}, ${q(d.bn)}, ${q(d.division?.name)}, ${q(d.division?.bn_name)}, ${num(d.lat)}, ${num(d.lng)})`,
      )
      .join(',\n') +
    `\non conflict (id) do update set
  name_en     = excluded.name_en,
  name_bn     = excluded.name_bn,
  division_en = excluded.division_en,
  division_bn = excluded.division_bn,
  lat         = excluded.lat,
  lng         = excluded.lng;
`

  const upazilaNote = missing.length
    ? `-- ${missing.length} upazila(s) have no usable boundary polygon and are seeded with a\n-- NULL centroid. The app falls back to the district centroid for those.`
    : '-- Every upazila has a centroid derived from its own boundary polygon.'

  const upazilaSql =
    HEADER(`Seed: all ${upazilaRows.length} upazilas of Bangladesh`, upazilaNote) +
    `insert into public.upazilas (id, district_id, name_en, name_bn, lat, lng) values\n` +
    upazilaRows
      .map((u) => `  (${u.id}, ${u.districtId}, ${q(u.en)}, ${q(u.bn)}, ${num(u.lat)}, ${num(u.lng)})`)
      .join(',\n') +
    `\non conflict (id) do update set
  district_id = excluded.district_id,
  name_en     = excluded.name_en,
  name_bn     = excluded.name_bn,
  lat         = excluded.lat,
  lng         = excluded.lng;
`

  writeFileSync(join(seedDir, '001_districts.sql'), districtSql)
  writeFileSync(join(seedDir, '002_upazilas.sql'), upazilaSql)
  console.log('wrote supabase/seed/001_districts.sql and 002_upazilas.sql')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
