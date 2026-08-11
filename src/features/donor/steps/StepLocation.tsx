import { Suspense, lazy, useEffect, useState } from 'react'
import { Field, Input, Select } from '@/components/form/Field'
import { Button } from '@/components/Button'
import { useI18n, type TKey } from '@/lib/i18n'
import { useGeolocation, isInBangladesh, type Coords } from '@/lib/geolocation'
import { locateArea, upazilasOf, usePlaces } from '@/lib/places'
import type { StepProps } from '../types'

/* Leaflet is about 45kb gzipped. It loads when this step is reached, not
   before, and never for someone who only searches. */
const LocationPicker = lazy(() => import('@/features/map/LocationPicker'))

const FAILURE_MESSAGE: Record<string, TKey> = {
  denied: 'location.error.denied',
  timeout: 'location.error.timeout',
  unavailable: 'location.error.unavailable',
  unsupported: 'location.error.unsupported',
}

export function StepLocation({ form, errors, update }: StepProps) {
  const { t, n, lang } = useI18n()
  const { districts, upazilas, loading, failed } = usePlaces()
  const geo = useGeolocation()
  const [showMap, setShowMap] = useState(Boolean(form.coords))
  const [areaNote, setAreaNote] = useState<string | null>(null)
  const [outsideCountry, setOutsideCountry] = useState(false)

  const label = (en: string, bn: string) => (lang === 'bn' ? bn : en)

  // When a fix arrives, fill the dropdowns and drop the pin. The user can
  // change any of it; nothing here is final.
  useEffect(() => {
    if (geo.status !== 'ready' || !geo.coords) return
    const coords = geo.coords

    if (!isInBangladesh(coords)) {
      // Do not silently move someone's pin into Bangladesh. Say so and leave
      // the dropdowns to them.
      setOutsideCountry(true)
      return
    }

    setOutsideCountry(false)
    update({ coords })
    setShowMap(true)

    let cancelled = false
    void locateArea(coords).then((area) => {
      if (cancelled || !area) return
      update({
        districtId: area.district_id,
        upazilaId: area.upazila_id ?? null,
      })
      setAreaNote(
        [label(area.district_en, area.district_bn), area.upazila_en && label(area.upazila_en, area.upazila_bn ?? area.upazila_en)]
          .filter(Boolean)
          .join(', '),
      )
    })
    return () => {
      cancelled = true
    }
    // update and label are stable enough for this effect's purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status, geo.coords])

  const onPinMoved = (coords: Coords) => {
    update({ coords })
    geo.setManual(coords)
    setAreaNote(null)
  }

  const districtUpazilas = upazilasOf(upazilas, form.districtId)

  return (
    <div className="grid gap-5">
      {/* The fast path first. Someone who taps this never touches a dropdown. */}
      <div className="rounded-md border-2 border-line bg-raise p-4 shadow-ink-1">
        <h3 className="text-base font-extrabold">{t('location.locateMe.title')}</h3>
        <p className="mt-1 text-sm text-muted">{t('location.locateMe.body')}</p>

        <Button
          onClick={geo.locate}
          disabled={geo.status === 'locating'}
          className="mt-3"
          variant="secondary"
        >
          {geo.status === 'locating' ? t('location.locating') : t('location.locateMe.action')}
        </Button>

        {/* Every outcome says something specific and leaves the dropdowns
            below as a way forward. Nobody gets stuck. */}
        {geo.status === 'error' && geo.error && (
          <p role="alert" className="mt-3 rounded-md border-2 border-line bg-gada-fill px-3 py-2 text-sm font-bold text-tile-ink">
            {t(FAILURE_MESSAGE[geo.error] ?? 'location.error.unavailable')}{' '}
            {t('location.error.fallback')}
          </p>
        )}

        {outsideCountry && (
          <p role="alert" className="mt-3 rounded-md border-2 border-line bg-gada-fill px-3 py-2 text-sm font-bold text-tile-ink">
            {t('location.error.outsideCountry')}
          </p>
        )}

        {geo.status === 'ready' && geo.coords && !outsideCountry && (
          <div className="mt-3 rounded-md border-2 border-line bg-jol-fill px-3 py-2 text-sm font-bold text-tile-ink">
            <p>{t('location.found')}</p>
            {geo.accuracy != null && (
              // Accuracy in metres, so the user knows whether the pin needs
              // correcting rather than having to guess.
              <p className="mt-0.5 font-normal">
                {geo.accuracy > 500
                  ? t('location.accuracy.poor', { metres: n(geo.accuracy) })
                  : t('location.accuracy.good', { metres: n(geo.accuracy) })}
              </p>
            )}
            {areaNote && <p className="mt-0.5 font-normal">{t('location.matched', { area: areaNote })}</p>}
          </div>
        )}
      </div>

      {failed && (
        <p role="alert" className="rounded-md border-2 border-line bg-gada-fill px-3 py-2 text-sm font-bold text-tile-ink">
          {t('location.places.failed')}
        </p>
      )}

      <Field label={t('form.district')} error={errors.districtId ? t(errors.districtId) : null} required>
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.districtId ?? ''}
            disabled={loading && districts.length === 0}
            onChange={(e) => {
              const value = e.target.value ? Number(e.target.value) : null
              // Changing district makes the old upazila meaningless.
              update({ districtId: value, upazilaId: null })
            }}
          >
            <option value="">
              {loading && districts.length === 0 ? t('common.loading') : t('form.choose')}
            </option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {label(d.name_en, d.name_bn)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label={t('form.upazila')} error={errors.upazilaId ? t(errors.upazilaId) : null}>
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.upazilaId ?? ''}
            disabled={!form.districtId}
            onChange={(e) => update({ upazilaId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">
              {form.districtId ? t('form.choose') : t('form.chooseDistrictFirst')}
            </option>
            {districtUpazilas.map((u) => (
              <option key={u.id} value={u.id}>
                {label(u.name_en, u.name_bn)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label={t('form.address')}
        hint={t('form.address.hint')}
        error={errors.addressLine ? t(errors.addressLine) : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.addressLine}
            onChange={(e) => update({ addressLine: e.target.value })}
            autoComplete="street-address"
          />
        )}
      </Field>

      {/* The map is opt-in on a slow connection. The dropdowns above already
          did the job; this only refines it. */}
      {!showMap ? (
        <Button variant="secondary" onClick={() => setShowMap(true)}>
          {t('location.map.open')}
        </Button>
      ) : (
        <Suspense
          fallback={
            <p role="status" className="text-sm text-muted">
              {t('location.map.loading')}
            </p>
          }
        >
          <LocationPicker value={form.coords} onChange={onPinMoved} accuracy={geo.accuracy} />
        </Suspense>
      )}

      <p className="text-sm text-muted">{t('location.privacy')}</p>
    </div>
  )
}
