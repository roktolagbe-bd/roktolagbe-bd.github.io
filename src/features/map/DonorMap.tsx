import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BANGLADESH_CENTRE, type Coords } from '@/lib/geolocation'
import { splitGroup } from '@/lib/blood'
import { useI18n } from '@/lib/i18n'
import type { DonorResult } from '@/features/search/useDonorSearch'

type Props = {
  donors: DonorResult[]
  origin: Coords | null
  className?: string
}

/**
 * Search results on a map.
 *
 * Every point plotted here is the FUZZED position: rounded to three decimals
 * and displaced by up to 800 metres when the donor row was written. The true
 * coordinates never leave the database, and the view this data comes from does
 * not contain them.
 *
 * The popup carries a name, a group and an area. No phone number, no address,
 * no link to contact anyone. That is the same rule the list follows.
 */
export default function DonorMap({ donors, origin, className }: Props) {
  const { t, n, lang } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    const map = L.map(container, {
      center: [origin?.lat ?? BANGLADESH_CENTRE.lat, origin?.lng ?? BANGLADESH_CENTRE.lng],
      zoom: origin ? 12 : 7,
      zoomControl: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    layer.clearLayers()
    const points: L.LatLngExpression[] = []

    if (origin) {
      // Where the search was made from, so distances make visual sense.
      L.circleMarker([origin.lat, origin.lng], {
        radius: 8,
        color: 'var(--c-line)',
        weight: 3,
        fillColor: 'var(--c-nil)',
        fillOpacity: 1,
      })
        .bindPopup(t('search.map.you'))
        .addTo(layer)
      points.push([origin.lat, origin.lng])
    }

    for (const donor of donors) {
      if (donor.lat_fuzzed == null || donor.lng_fuzzed == null) continue
      const { letters, sign } = splitGroup(donor.blood_group)

      const marker = L.marker([donor.lat_fuzzed, donor.lng_fuzzed], {
        icon: L.divIcon({
          className: '',
          html: `<span style="
              display:flex;align-items:center;justify-content:center;
              width:30px;height:30px;border-radius:10px;
              border:2px solid var(--c-line);
              background:var(--tile-${letters.toLowerCase()}-${sign === '+' ? 'pos' : 'neg'});
              color:var(--tile-ink);font-weight:800;font-size:11px;
            ">${letters}${sign}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        title: donor.display_name,
      })

      const area = [
        lang === 'bn' ? donor.upazila_bn : donor.upazila_en,
        lang === 'bn' ? donor.district_bn : donor.district_en,
      ]
        .filter(Boolean)
        .join(', ')

      marker.bindPopup(
        `<strong>${escapeHtml(donor.display_name)}</strong> &middot; ${escapeHtml(donor.blood_group)}<br>` +
          `${escapeHtml(area)}<br>` +
          `<em>${escapeHtml(
            donor.is_available ? t('search.available') : t('search.resting'),
          )}</em>` +
          (typeof donor.distance_km === 'number'
            ? `<br>${escapeHtml(t('search.away', { km: n(Math.round(donor.distance_km * 10) / 10) }))}`
            : '') +
          `<br><small>${escapeHtml(t('search.map.approximate'))}</small>`,
      )

      marker.addTo(layer)
      points.push([donor.lat_fuzzed, donor.lng_fuzzed])
    }

    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.15), { maxZoom: 14 })
    } else if (points.length === 1) {
      map.setView(points[0] as L.LatLngExpression, 13)
    }
  }, [donors, origin, t, n, lang])

  return (
    <div
      ref={containerRef}
      className={className}
      role="application"
      aria-label={t('search.map.label')}
    />
  )
}

/* Donor display names come from a form. They are escaped before they are put
   into popup HTML, because Leaflet's bindPopup takes raw markup. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
