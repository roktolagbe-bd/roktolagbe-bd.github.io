import { useCallback, useRef, useState } from 'react'

export type Coords = { lat: number; lng: number }

export type GeolocationState = {
  status: 'idle' | 'locating' | 'ready' | 'error'
  coords: Coords | null
  /** Metres. Tells the user whether the pin needs correcting. */
  accuracy: number | null
  /** Which failure happened, so the UI can say something specific. */
  error: GeolocationFailure | null
}

export type GeolocationFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported'

const TIMEOUT_MS = 10_000

/**
 * Location on request only.
 *
 * The permission prompt is asked for when the user taps "Locate me" and never
 * on page load. An unexpected prompt makes people close the tab, and this site
 * has about thirty seconds of their attention.
 *
 * Every failure path ends somewhere useful. There is no state where the user
 * is left with a spinner and no way forward: the district and upazila
 * dropdowns are always there, and the caller shows them on error.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    status: 'idle',
    coords: null,
    accuracy: null,
    error: null,
  })

  // A late-arriving result from a previous attempt must not overwrite a newer
  // one, and must not fire after the component has moved on.
  const attempt = useRef(0)

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ status: 'error', coords: null, accuracy: null, error: 'unsupported' })
      return
    }

    const current = ++attempt.current
    setState((s) => ({ ...s, status: 'locating', error: null }))

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (current !== attempt.current) return
        setState({
          status: 'ready',
          coords: { lat: position.coords.latitude, lng: position.coords.longitude },
          accuracy: Math.round(position.coords.accuracy),
          error: null,
        })
      },
      (err) => {
        if (current !== attempt.current) return
        const error: GeolocationFailure =
          err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable'
        setState({ status: 'error', coords: null, accuracy: null, error })
      },
      {
        enableHighAccuracy: true,
        timeout: TIMEOUT_MS,
        // A fix from the last minute is fine and much faster than a new one.
        maximumAge: 60_000,
      },
    )
  }, [])

  /** Used when the user drags the pin: their correction wins over the device. */
  const setManual = useCallback((coords: Coords) => {
    attempt.current++
    setState({ status: 'ready', coords, accuracy: null, error: null })
  }, [])

  const reset = useCallback(() => {
    attempt.current++
    setState({ status: 'idle', coords: null, accuracy: null, error: null })
  }, [])

  return { ...state, locate, setManual, reset }
}

/** Rough centre of Bangladesh, used to open the map before anything is chosen. */
export const BANGLADESH_CENTRE: Coords = { lat: 23.685, lng: 90.3563 }

export const BANGLADESH_BOUNDS = {
  minLat: 20.5,
  maxLat: 26.7,
  minLng: 88.0,
  maxLng: 92.75,
}

export function isInBangladesh({ lat, lng }: Coords): boolean {
  return (
    lat >= BANGLADESH_BOUNDS.minLat &&
    lat <= BANGLADESH_BOUNDS.maxLat &&
    lng >= BANGLADESH_BOUNDS.minLng &&
    lng <= BANGLADESH_BOUNDS.maxLng
  )
}
