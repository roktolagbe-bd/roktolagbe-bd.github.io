import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BANGLADESH_CENTRE, type Coords } from '@/lib/geolocation'
import { useI18n } from '@/lib/i18n'

type Props = {
  value: Coords | null
  onChange: (coords: Coords) => void
  /** Metres. Drawn as a circle so the user can see how rough the fix is. */
  accuracy?: number | null
  className?: string
}

/**
 * A draggable pin on an OpenStreetMap.
 *
 * This whole module, Leaflet included, is a lazy chunk. It is roughly 45kb
 * gzipped and most visitors never reach a page that needs it.
 *
 * Written against Leaflet directly rather than a React wrapper: the wrapper
 * would add another dependency to do what amounts to one useEffect, and this
 * way the map is created once and never torn down by a re-render.
 */
export default function LocationPicker({ value, onChange, accuracy, className }: Props) {
  const { t, lang } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const circleRef = useRef<L.Circle | null>(null)
  // Kept in a ref so moving the pin never re-creates the map.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    const start = value ?? BANGLADESH_CENTRE
    const map = L.map(container, {
      center: [start.lat, start.lng],
      zoom: value ? 15 : 7,
      // The zoom buttons are small targets. Pinch works, and we add our own
      // larger controls outside the map.
      zoomControl: false,
      attributionControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Required by the OpenStreetMap tile usage policy, and fair anyway.
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    // A flat pin drawn in CSS. Leaflet's default marker loads image files that
    // bundlers routinely mangle, and this one matches the rest of the site.
    const icon = L.divIcon({
      className: '',
      html: `<span class="block size-6 rounded-full border-[3px] border-[color:var(--c-line)] bg-[color:var(--c-shindur-fill)] shadow-[0_0_0_3px_rgba(0,0,0,0.15)]"></span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })

    const marker = L.marker([start.lat, start.lng], {
      draggable: true,
      keyboard: true,
      icon,
      title: t('location.pin.title'),
      alt: t('location.pin.title'),
    }).addTo(map)

    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng()
      onChangeRef.current({ lat, lng })
    })

    // Tapping the map moves the pin. Faster than dragging on a phone.
    map.on('click', (event: L.LeafletMouseEvent) => {
      marker.setLatLng(event.latlng)
      onChangeRef.current({ lat: event.latlng.lat, lng: event.latlng.lng })
    })

    mapRef.current = map
    markerRef.current = marker

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
      circleRef.current = null
    }
    // Created once. Later prop changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the value when it changes from outside, for example after the user
  // taps "Locate me" or picks a different district.
  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!map || !marker || !value) return

    const current = marker.getLatLng()
    // Ignore the echo of a drag we just reported, otherwise the map fights the
    // user's own gesture.
    if (Math.abs(current.lat - value.lat) < 1e-7 && Math.abs(current.lng - value.lng) < 1e-7) {
      return
    }

    marker.setLatLng([value.lat, value.lng])
    map.setView([value.lat, value.lng], Math.max(map.getZoom(), 15))
  }, [value])

  // Draw the accuracy circle so "within 2km" is visible rather than a number
  // the user has to interpret.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    circleRef.current?.remove()
    circleRef.current = null

    if (value && accuracy && accuracy > 30) {
      circleRef.current = L.circle([value.lat, value.lng], {
        radius: accuracy,
        color: 'var(--c-nil)',
        weight: 2,
        fillOpacity: 0.08,
      }).addTo(map)
    }
  }, [value, accuracy])

  return (
    <div className={className}>
      <div
        ref={containerRef}
        // Leaflet needs a real height, and a map is useless below this size.
        className="h-72 w-full overflow-hidden rounded-md border-2 border-line shadow-ink-1 sm:h-80"
        // The map is a supplementary control: the dropdowns are the accessible
        // path to the same outcome, so this is not a keyboard trap.
        role="application"
        aria-label={t('location.map.label')}
        lang={lang}
      />
      <p className="mt-1.5 text-sm text-muted">{t('location.map.help')}</p>
    </div>
  )
}
