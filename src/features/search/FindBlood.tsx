import { Suspense, lazy, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Field, Select } from '@/components/form/Field'
import { Button, ButtonLink } from '@/components/Button'
import { useI18n, type TKey } from '@/lib/i18n'
import { BLOOD_GROUPS, groupToSlug, slugToGroup, type BloodGroup } from '@/lib/blood'
import { useGeolocation, isInBangladesh } from '@/lib/geolocation'
import { locateArea, upazilasOf, usePlaces } from '@/lib/places'
import { cn } from '@/lib/cn'
import { DonorCard } from './DonorCard'
import { useDonorSearch, type SearchFilters } from './useDonorSearch'

const DonorMap = lazy(() => import('@/features/map/DonorMap'))

const RADIUS_OPTIONS = [5, 10, 25, 50, 100]

const GEO_ERROR: Record<string, TKey> = {
  denied: 'location.error.denied',
  timeout: 'location.error.timeout',
  unavailable: 'location.error.unavailable',
  unsupported: 'location.error.unsupported',
}

export function FindBlood() {
  const { t, n, lang } = useI18n()
  const { districts, upazilas } = usePlaces()
  const geo = useGeolocation()
  const [params, setParams] = useSearchParams()

  // The blood group lives in the URL so a tapped tile on the landing page
  // arrives here already answered, and so a search can be shared or bookmarked.
  const bloodGroup = slugToGroup(params.get('g'))
  const [districtId, setDistrictId] = useState<number | null>(null)
  const [upazilaId, setUpazilaId] = useState<number | null>(null)
  const [radiusKm, setRadiusKm] = useState(25)
  const [view, setView] = useState<'list' | 'map'>('list')

  const usingLocation = geo.status === 'ready' && geo.coords && isInBangladesh(geo.coords)

  const filters = useMemo<SearchFilters>(
    () => ({
      bloodGroup,
      districtId,
      upazilaId,
      origin: usingLocation ? geo.coords : null,
      radiusKm,
    }),
    [bloodGroup, districtId, upazilaId, usingLocation, geo.coords, radiusKm],
  )

  const { results, loading, error, fromCache, savedAt } = useDonorSearch(filters)

  const label = (en: string | null, bn: string | null) => (lang === 'bn' ? bn : en) ?? ''

  const setGroup = (group: BloodGroup | null) => {
    const next = new URLSearchParams(params)
    if (group) next.set('g', groupToSlug(group))
    else next.delete('g')
    setParams(next, { replace: true })
  }

  const onLocate = () => {
    geo.locate()
    // Fill in the dropdowns too, so switching back to area search keeps context.
    void (async () => {
      const coords = geo.coords
      if (!coords) return
      const area = await locateArea(coords)
      if (area) {
        setDistrictId(area.district_id)
        setUpazilaId(area.upazila_id ?? null)
      }
    })()
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-hero font-extrabold">{t('page.find.title')}</h1>

      {/* ---- Filters ---- */}
      <div className="mt-6 grid gap-4 rounded-md border-2 border-line bg-raise p-4 shadow-ink-1">
        <fieldset>
          <legend className="text-sm font-bold">{t('form.bloodGroup')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {BLOOD_GROUPS.map((group) => {
              const active = bloodGroup === group
              return (
                <button
                  key={group}
                  type="button"
                  onClick={() => setGroup(active ? null : group)}
                  aria-pressed={active}
                  className={cn(
                    'ink-press min-h-11 min-w-14 rounded-md border-2 border-line px-3 font-extrabold shadow-ink-1',
                    active ? 'bg-ink text-surface' : 'bg-raise text-ink',
                  )}
                >
                  {group}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('form.district')}>
            {({ id }) => (
              <Select
                id={id}
                value={districtId ?? ''}
                onChange={(e) => {
                  setDistrictId(e.target.value ? Number(e.target.value) : null)
                  setUpazilaId(null)
                }}
              >
                <option value="">{t('search.anyDistrict')}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {label(d.name_en, d.name_bn)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={t('form.upazila')}>
            {({ id }) => (
              <Select
                id={id}
                value={upazilaId ?? ''}
                disabled={!districtId}
                onChange={(e) => setUpazilaId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">
                  {districtId ? t('search.anyUpazila') : t('form.chooseDistrictFirst')}
                </option>
                {upazilasOf(upazilas, districtId).map((u) => (
                  <option key={u.id} value={u.id}>
                    {label(u.name_en, u.name_bn)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {/* The shortcut past all of the above. */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={onLocate} disabled={geo.status === 'locating'}>
            {geo.status === 'locating' ? t('location.locating') : t('search.nearMe')}
          </Button>

          {usingLocation && (
            <Field label={t('search.radius')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  className="min-w-32"
                >
                  {RADIUS_OPTIONS.map((km) => (
                    <option key={km} value={km}>
                      {t('search.withinKm', { km: n(km) })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        {geo.status === 'error' && geo.error && (
          <p role="alert" className="rounded-md border-2 border-line bg-gada-fill px-3 py-2 text-sm font-bold text-tile-ink">
            {t(GEO_ERROR[geo.error] ?? 'location.error.unavailable')} {t('location.error.fallback')}
          </p>
        )}

        {usingLocation && !bloodGroup && (
          <p className="text-sm text-muted">{t('search.pickGroupForDistance')}</p>
        )}
      </div>

      {/* ---- Result header and view switch ---- */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm font-bold">
          {loading && results.length === 0
            ? t('common.loading')
            : t('search.resultCount', { count: results.length })}
          {fromCache && savedAt && (
            <span className="ml-2 font-normal text-muted">{t('search.fromCache')}</span>
          )}
        </p>

        {/* Tabs on mobile, both panels side by side from lg. */}
        <div className="flex overflow-hidden rounded-md border-2 border-line shadow-ink-1 lg:hidden">
          {(['list', 'map'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              aria-pressed={view === mode}
              className={cn(
                'min-h-11 px-4 text-sm font-bold',
                view === mode ? 'bg-ink text-surface' : 'bg-raise text-ink',
              )}
            >
              {mode === 'list' ? t('search.view.list') : t('search.view.map')}
            </button>
          ))}
        </div>
      </div>

      {error === 'not_configured' && (
        <p role="status" className="mt-4 rounded-md border-2 border-line bg-sunk px-3 py-2 text-sm">
          {t('config.missing.title')}
        </p>
      )}
      {error === 'offline' && results.length > 0 && (
        <p role="status" className="mt-4 rounded-md border-2 border-line bg-gada-fill px-3 py-2 text-sm font-bold text-tile-ink">
          {t('search.offlineShowingCached')}
        </p>
      )}
      {error === 'failed' && results.length === 0 && (
        <p role="alert" className="mt-4 rounded-md border-2 border-line bg-shindur-fill px-3 py-2 text-sm font-bold text-tile-ink">
          {t('search.failed')}
        </p>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---- List ---- */}
        <div className={cn(view === 'map' && 'hidden lg:block')}>
          {results.length === 0 && !loading ? (
            <div className="rounded-md border-2 border-line bg-raise p-6 text-center shadow-ink-1">
              <p className="font-extrabold">{t('search.empty.title')}</p>
              <p className="mt-1 text-sm text-muted">{t('search.empty.body')}</p>
              <ButtonLink to="/request" variant="urgent" className="mt-4">
                {t('search.empty.action')}
              </ButtonLink>
            </div>
          ) : (
            <ul className="grid gap-2">
              {results.map((donor) => (
                <DonorCard key={donor.id} donor={donor} />
              ))}
            </ul>
          )}
        </div>

        {/* ---- Map ---- */}
        <div className={cn(view === 'list' && 'hidden lg:block')}>
          <Suspense
            fallback={
              <p role="status" className="text-sm text-muted">
                {t('location.map.loading')}
              </p>
            }
          >
            <DonorMap
              donors={results}
              origin={usingLocation ? geo.coords : null}
              className="h-[420px] w-full overflow-hidden rounded-md border-2 border-line shadow-ink-1 lg:sticky lg:top-24"
            />
          </Suspense>
          <p className="mt-2 text-sm text-muted">{t('search.map.approximate')}</p>
        </div>
      </div>

      <div className="mt-10 rounded-md border-2 border-line bg-sunk p-5">
        <h2 className="font-extrabold">{t('search.cta.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('search.cta.body')}</p>
        <ButtonLink to="/request" variant="urgent" size="lg" className="mt-4">
          {t('search.cta.action')}
        </ButtonLink>
      </div>
    </section>
  )
}
