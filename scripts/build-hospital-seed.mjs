#!/usr/bin/env node
/**
 * Generates supabase/seed/003_hospitals.sql.
 *
 * Run it with:   node scripts/build-hospital-seed.mjs
 *
 * The hospital names below are curated by hand. The coordinates are NOT: they
 * are looked up once from Nominatim and checked against the district centroid,
 * because a hospital pin that is confidently wrong is worse than no pin at all
 * when someone is trying to get there.
 *
 * This is a one-off build step whose output is committed. It is not the
 * runtime geocoder; that is the `geocode` Edge Function, which sets a real
 * User-Agent and caches into geocode_cache. Nominatim's usage policy asks for
 * at most one request per second and an identifiable User-Agent, and this
 * script does both.
 *
 * Anything that fails to geocode, or lands too far from its district, is still
 * seeded with a NULL position and flagged in the output so an admin can fix it
 * from the master data screen. A missing pin degrades gracefully; a wrong one
 * does not.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const USER_AGENT = 'Roktolagbe/1.0 (blood donor directory for Bangladesh; roktolagbe.bd@gmail.com)'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const DISTRICTS_URL =
  'https://raw.githubusercontent.com/ifahimreza/bangladesh-geojson/master/src/data/bd-districts.json'

/* A hospital more than this far from its district centre was mis-geocoded. */
const MAX_KM_FROM_DISTRICT = 60

/**
 * Starter list. Government medical college hospitals first, since those are
 * where most emergency transfusions actually happen, then the larger private
 * hospitals. Extend this freely: it is an ordinary array and the file it
 * generates is meant to grow.
 */
const HOSPITALS = [
  // ---- Dhaka ----
  { district: 'Dhaka', en: 'Dhaka Medical College Hospital', bn: 'ঢাকা মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Dhaka', en: 'Bangabandhu Sheikh Mujib Medical University', bn: 'বঙ্গবন্ধু শেখ মুজিব মেডিকেল বিশ্ববিদ্যালয়' },
  { district: 'Dhaka', en: 'Sir Salimullah Medical College Mitford Hospital', bn: 'স্যার সলিমুল্লাহ মেডিকেল কলেজ মিটফোর্ড হাসপাতাল' },
  { district: 'Dhaka', en: 'Shaheed Suhrawardy Medical College Hospital', bn: 'শহীদ সোহরাওয়ার্দী মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Dhaka', en: 'Mugda Medical College Hospital', bn: 'মুগদা মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Dhaka', en: 'Kurmitola General Hospital', bn: 'কুর্মিটোলা জেনারেল হাসপাতাল' },
  { district: 'Dhaka', en: 'National Institute of Cardiovascular Diseases', bn: 'জাতীয় হৃদরোগ ইনস্টিটিউট' },
  { district: 'Dhaka', en: 'National Institute of Traumatology and Orthopaedic Rehabilitation', bn: 'পঙ্গু হাসপাতাল' },
  { district: 'Dhaka', en: 'Dhaka Shishu Hospital', bn: 'ঢাকা শিশু হাসপাতাল' },
  { district: 'Dhaka', en: 'BIRDEM General Hospital', bn: 'বারডেম জেনারেল হাসপাতাল' },
  { district: 'Dhaka', en: 'Holy Family Red Crescent Medical College Hospital', bn: 'হলি ফ্যামিলি রেড ক্রিসেন্ট মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Dhaka', en: 'Square Hospital', bn: 'স্কয়ার হাসপাতাল' },
  { district: 'Dhaka', en: 'United Hospital Dhaka', bn: 'ইউনাইটেড হাসপাতাল' },
  { district: 'Dhaka', en: 'Evercare Hospital Dhaka', bn: 'এভারকেয়ার হাসপাতাল ঢাকা' },
  { district: 'Dhaka', en: 'Ibn Sina Specialized Hospital Dhanmondi', bn: 'ইবনে সিনা স্পেশালাইজড হাসপাতাল' },
  { district: 'Dhaka', en: 'Popular Medical College Hospital Dhanmondi', bn: 'পপুলার মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Dhaka', en: 'Central Hospital Dhanmondi', bn: 'সেন্ট্রাল হাসপাতাল' },
  { district: 'Dhaka', en: 'Bangladesh Medical College Hospital', bn: 'বাংলাদেশ মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Dhaka', en: 'Islami Bank Central Hospital Kakrail', bn: 'ইসলামী ব্যাংক কেন্দ্রীয় হাসপাতাল' },

  // ---- Chattogram ----
  { district: 'Chattogram', en: 'Chittagong Medical College Hospital', bn: 'চট্টগ্রাম মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Chattogram', en: 'Chattogram General Hospital', bn: 'চট্টগ্রাম জেনারেল হাসপাতাল' },
  { district: 'Chattogram', en: 'Chittagong Maa O Shishu Hospital', bn: 'চট্টগ্রাম মা ও শিশু হাসপাতাল' },
  { district: 'Chattogram', en: 'Imperial Hospital Chattogram', bn: 'ইম্পেরিয়াল হাসপাতাল' },
  { district: 'Chattogram', en: 'Evercare Hospital Chattogram', bn: 'এভারকেয়ার হাসপাতাল চট্টগ্রাম' },
  { district: 'Chattogram', en: 'Centre for Specialized Care and Research Chattogram', bn: 'সিএসসিআর হাসপাতাল' },
  { district: 'Chattogram', en: 'Parkview Hospital Chattogram', bn: 'পার্কভিউ হাসপাতাল' },
  { district: 'Chattogram', en: 'Chattogram Medical University Hospital', bn: 'চট্টগ্রাম মেডিকেল বিশ্ববিদ্যালয় হাসপাতাল' },

  // ---- Sylhet ----
  { district: 'Sylhet', en: 'Sylhet MAG Osmani Medical College Hospital', bn: 'সিলেট এম এ জি ওসমানী মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Sylhet', en: 'Sylhet Sadar Hospital', bn: 'সিলেট সদর হাসপাতাল' },
  { district: 'Sylhet', en: 'Jalalabad Ragib-Rabeya Medical College Hospital', bn: 'জালালাবাদ রাগীব-রাবেয়া মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Sylhet', en: 'North East Medical College Hospital Sylhet', bn: 'নর্থ ইস্ট মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Sylhet', en: 'Ibn Sina Hospital Sylhet', bn: 'ইবনে সিনা হাসপাতাল সিলেট' },
  { district: 'Sylhet', en: 'Mount Adora Hospital Sylhet', bn: 'মাউন্ট এডোরা হাসপাতাল' },

  // ---- Rajshahi ----
  { district: 'Rajshahi', en: 'Rajshahi Medical College Hospital', bn: 'রাজশাহী মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Rajshahi', en: 'Rajshahi Sadar Hospital', bn: 'রাজশাহী সদর হাসপাতাল' },
  { district: 'Rajshahi', en: 'Islami Bank Medical College Hospital Rajshahi', bn: 'ইসলামী ব্যাংক মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Rajshahi', en: 'Rajshahi Christian Mission Hospital', bn: 'রাজশাহী খ্রিস্টান মিশন হাসপাতাল' },

  // ---- Khulna ----
  { district: 'Khulna', en: 'Khulna Medical College Hospital', bn: 'খুলনা মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Khulna', en: 'Khulna General Hospital', bn: 'খুলনা জেনারেল হাসপাতাল' },
  { district: 'Khulna', en: 'Gazi Medical College Hospital Khulna', bn: 'গাজী মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Khulna', en: 'Ad-din Akij Medical College Hospital Khulna', bn: 'আদ-দ্বীন আকিজ মেডিকেল কলেজ হাসপাতাল' },
  { district: 'Khulna', en: 'Khulna Shishu Hospital', bn: 'খুলনা শিশু হাসপাতাল' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

const q = (v) => (v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`)
const num = (v) => (v == null ? 'NULL' : Number(v).toFixed(6))

async function geocode(query) {
  const url = `${NOMINATIM}?${new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'bd',
    addressdetails: '0',
  })}`

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const rows = await res.json()
  if (!rows.length) return null
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon), label: rows[0].display_name }
}

async function main() {
  const districtsJson = await (await fetch(DISTRICTS_URL)).json()
  const districts = Object.values(districtsJson).find(Array.isArray)
  const districtByName = new Map(districts.map((d) => [d.name.toLowerCase(), d]))

  const rows = []
  let located = 0
  const problems = []

  for (const h of HOSPITALS) {
    const district = districtByName.get(h.district.toLowerCase())
    if (!district) throw new Error(`Unknown district in the curated list: ${h.district}`)
    const centre = { lat: Number(district.lat), lng: Number(district.long) }

    let point = null
    try {
      const hit = await geocode(`${h.en}, ${h.district}, Bangladesh`)
      if (hit) {
        const away = distanceKm(hit, centre)
        if (away <= MAX_KM_FROM_DISTRICT) {
          point = hit
          located++
        } else {
          problems.push(`${h.en}: geocoded ${away.toFixed(0)}km from ${h.district}, rejected`)
        }
      } else {
        problems.push(`${h.en}: no result`)
      }
    } catch (err) {
      problems.push(`${h.en}: ${err.message}`)
    }

    rows.push({ ...h, districtId: Number(district.id), point })
    // Nominatim asks for no more than one request per second. Be a good guest.
    await sleep(1100)
  }

  console.log(`located ${located}/${HOSPITALS.length}`)
  if (problems.length) console.log(`needs an admin to place manually:\n  ${problems.join('\n  ')}`)

  const sql = `-- Seed: starter hospital list
--
-- GENERATED FILE. Regenerate with:  node scripts/build-hospital-seed.mjs
--
-- Names are curated by hand. Positions come from Nominatim (OpenStreetMap,
-- ODbL) and every one was checked to be within ${MAX_KM_FROM_DISTRICT}km of its district centre.
-- ${rows.length - located} hospital(s) could not be placed and have a NULL position; they still
-- appear in the dropdown, and an admin can set the pin from master data.
--
-- This is a starting point, not a register. Add your own with plain INSERTs or
-- through the admin panel.

insert into public.hospitals (name_en, name_bn, district_id, lat, lng) values
${rows
  .map((r) => `  (${q(r.en)}, ${q(r.bn)}, ${r.districtId}, ${num(r.point?.lat)}, ${num(r.point?.lng)})`)
  .join(',\n')}
on conflict do nothing;
`

  const seedDir = join(process.cwd(), 'supabase', 'seed')
  mkdirSync(seedDir, { recursive: true })
  writeFileSync(join(seedDir, '003_hospitals.sql'), sql)
  console.log('wrote supabase/seed/003_hospitals.sql')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
