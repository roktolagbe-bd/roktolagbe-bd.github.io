import { useEffect, useMemo, useState } from 'react'
import { Field, Input, Select, Textarea } from '@/components/form/Field'
import { Button, ButtonLink } from '@/components/Button'
import { Honeypot, useFormTiming } from '@/components/form/Honeypot'
import { useI18n, type TKey } from '@/lib/i18n'
import { BLOOD_GROUPS, type BloodGroup } from '@/lib/blood'
import { useGeolocation, isInBangladesh } from '@/lib/geolocation'
import { locateArea, upazilasOf, usePlaces, type Hospital } from '@/lib/places'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { normalisePhone } from '@/features/donor/validation'
import { cn } from '@/lib/cn'
import {
  emptyRequestForm,
  submitRequest,
  type RequestForm as FormShape,
  type MatchOutcome,
  type Urgency,
} from './submit'

const URGENCIES: Array<{ value: Urgency; key: TKey; hint: TKey }> = [
  { value: 'critical', key: 'request.urgency.critical', hint: 'request.urgency.critical.hint' },
  { value: 'urgent', key: 'request.urgency.urgent', hint: 'request.urgency.urgent.hint' },
  { value: 'scheduled', key: 'request.urgency.scheduled', hint: 'request.urgency.scheduled.hint' },
]

const FAILURE: Record<string, TKey> = {
  not_configured: 'request.error.notConfigured',
  rate_limited: 'request.error.rateLimited',
  offline: 'register.error.offline',
  unknown: 'register.error.unknown',
}

type Errors = Partial<Record<keyof FormShape, TKey>>

export function RequestForm() {
  const { t, lang } = useI18n()
  const { districts, upazilas } = usePlaces()
  const geo = useGeolocation()
  const timing = useFormTiming(4)

  const [form, setForm] = useState<FormShape>(emptyRequestForm)
  const [errors, setErrors] = useState<Errors>({})
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<TKey | null>(null)
  const [done, setDone] = useState<{ match: MatchOutcome | null } | null>(null)
  const [hospitals, setHospitals] = useState<Hospital[]>([])

  const update = (patch: Partial<FormShape>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch) as (keyof FormShape)[]) delete next[key]
      return next
    })
  }

  // Hospitals are fetched per district: loading all of them would be pointless
  // weight on a connection that is already struggling.
  useEffect(() => {
    if (!form.districtId) {
      setHospitals([])
      return
    }
    let cancelled = false
    void (async () => {
      const pending = getSupabase()
      if (!pending) return
      try {
        const supabase = await pending
        const { data } = await supabase
          .from('hospitals_public')
          .select('id, name_en, name_bn, district_id, lat, lng')
          .eq('district_id', form.districtId)
          .order('name_en')
        if (!cancelled) setHospitals((data ?? []) as Hospital[])
      } catch {
        if (!cancelled) setHospitals([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [form.districtId])

  // A fix fills in the area and gives the matcher a precise origin.
  useEffect(() => {
    if (geo.status !== 'ready' || !geo.coords || !isInBangladesh(geo.coords)) return
    const coords = geo.coords
    update({ coords })
    void locateArea(coords).then((area) => {
      if (!area) return
      update({ districtId: area.district_id, upazilaId: area.upazila_id ?? null })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status, geo.coords])

  const label = (en: string | null, bn: string | null) => (lang === 'bn' ? bn : en) ?? ''

  const selectedHospital = useMemo(
    () => hospitals.find((h) => h.id === form.hospitalId) ?? null,
    [hospitals, form.hospitalId],
  )

  function validate(): Errors {
    const next: Errors = {}
    if (form.requesterName.trim().length < 2) next.requesterName = 'validation.nameRequired'
    if (!form.requesterPhone.trim()) next.requesterPhone = 'validation.phoneRequired'
    else if (!normalisePhone(form.requesterPhone)) next.requesterPhone = 'validation.phoneInvalid'
    if (form.requesterWhatsapp.trim() && !normalisePhone(form.requesterWhatsapp)) {
      next.requesterWhatsapp = 'validation.phoneInvalid'
    }
    if (!form.bloodGroup) next.bloodGroup = 'validation.bloodGroupRequired'
    if (!form.districtId) next.districtId = 'validation.districtRequired'
    // The schema requires one or the other, so catch it here with a readable
    // message instead of letting Postgres reject it.
    if (!form.hospitalId && !form.hospitalFreeText.trim()) {
      next.hospitalFreeText = 'validation.hospitalRequired'
    }
    return next
  }

  const onSubmit = async () => {
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return
    if (honeypot.trim() !== '' || timing.tooFast()) {
      setFailure('register.error.unknown')
      return
    }

    setSubmitting(true)
    setFailure(null)

    // If a hospital was chosen and the requester never shared a location, the
    // hospital's own position is the best origin the matcher can have.
    const coords =
      form.coords ??
      (selectedHospital?.lat != null && selectedHospital?.lng != null
        ? { lat: selectedHospital.lat, lng: selectedHospital.lng }
        : null)

    const result = await submitRequest({ ...form, coords })
    setSubmitting(false)

    if (result.ok) setDone({ match: result.match })
    else setFailure(FAILURE[result.reason] ?? 'register.error.unknown')
  }

  if (done) return <RequestSent match={done.match} />

  return (
    <section className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-hero font-extrabold">{t('page.request.title')}</h1>
      <p className="mt-2 text-muted">{t('request.intro')}</p>

      {!isSupabaseConfigured && (
        <p role="status" className="mt-4 rounded-md border-2 border-line bg-gada-fill px-3 py-2 text-sm font-bold text-tile-ink">
          {t('request.error.notConfigured')}
        </p>
      )}

      <form
        className="relative mt-6 grid gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void onSubmit()
        }}
        noValidate
      >
        <Honeypot value={honeypot} onChange={setHoneypot} />

        {/* ---- What is needed ---- */}
        <fieldset>
          <legend className="text-sm font-bold">
            {t('form.bloodGroup')}
            <span className="text-shindur" aria-hidden="true"> *</span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {BLOOD_GROUPS.map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => update({ bloodGroup: group as BloodGroup })}
                aria-pressed={form.bloodGroup === group}
                className={cn(
                  'ink-press min-h-11 min-w-14 rounded-md border-2 border-line px-3 font-extrabold shadow-ink-1',
                  form.bloodGroup === group ? 'bg-ink text-surface' : 'bg-raise text-ink',
                )}
              >
                {group}
              </button>
            ))}
          </div>
          {errors.bloodGroup && (
            <p role="alert" className="mt-2 text-sm font-bold text-shindur">
              {t(errors.bloodGroup)}
            </p>
          )}
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('request.units')} required>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                value={form.unitsNeeded}
                onChange={(e) => update({ unitsNeeded: e.target.value })}
              />
            )}
          </Field>

          <Field label={t('request.neededBy')} hint={t('request.neededBy.hint')}>
            {({ id }) => (
              <Input
                id={id}
                type="datetime-local"
                value={form.neededBy}
                onChange={(e) => update({ neededBy: e.target.value })}
              />
            )}
          </Field>
        </div>

        <fieldset>
          <legend className="text-sm font-bold">{t('request.urgency')}</legend>
          <div className="mt-2 grid gap-2">
            {URGENCIES.map((option) => (
              <label
                key={option.value}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-md border-2 border-line p-3 shadow-ink-1',
                  form.urgency === option.value ? 'bg-ink text-surface' : 'bg-raise',
                )}
              >
                <input
                  type="radio"
                  name="urgency"
                  className="mt-1 size-5 shrink-0 accent-nil"
                  checked={form.urgency === option.value}
                  onChange={() => update({ urgency: option.value })}
                />
                <span>
                  <span className="block text-sm font-extrabold">{t(option.key)}</span>
                  <span
                    className={cn(
                      'block text-sm',
                      form.urgency === option.value ? 'opacity-80' : 'text-muted',
                    )}
                  >
                    {t(option.hint)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* ---- Where ---- */}
        <div className="grid gap-4 rounded-md border-2 border-line bg-raise p-4 shadow-ink-1">
          <Button
            type="button"
            variant="secondary"
            onClick={geo.locate}
            disabled={geo.status === 'locating'}
          >
            {geo.status === 'locating' ? t('location.locating') : t('request.useMyLocation')}
          </Button>

          {geo.status === 'error' && (
            <p role="alert" className="rounded-md border-2 border-line bg-gada-fill px-3 py-2 text-sm font-bold text-tile-ink">
              {t('location.error.fallback')}
            </p>
          )}

          <Field label={t('form.district')} error={errors.districtId ? t(errors.districtId) : null} required>
            {({ id, invalid }) => (
              <Select
                id={id}
                invalid={invalid}
                value={form.districtId ?? ''}
                onChange={(e) =>
                  update({
                    districtId: e.target.value ? Number(e.target.value) : null,
                    upazilaId: null,
                    hospitalId: null,
                  })
                }
              >
                <option value="">{t('form.choose')}</option>
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
                value={form.upazilaId ?? ''}
                disabled={!form.districtId}
                onChange={(e) => update({ upazilaId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">
                  {form.districtId ? t('form.choose') : t('form.chooseDistrictFirst')}
                </option>
                {upazilasOf(upazilas, form.districtId).map((u) => (
                  <option key={u.id} value={u.id}>
                    {label(u.name_en, u.name_bn)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={t('request.hospital')} hint={t('request.hospital.hint')}>
            {({ id }) => (
              <Select
                id={id}
                value={form.hospitalId ?? ''}
                disabled={!form.districtId}
                onChange={(e) => update({ hospitalId: e.target.value || null })}
              >
                <option value="">{t('request.hospital.other')}</option>
                {hospitals.map((h) => (
                  <option key={h.id} value={h.id}>
                    {label(h.name_en, h.name_bn)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {!form.hospitalId && (
            <Field
              label={t('request.hospitalName')}
              error={errors.hospitalFreeText ? t(errors.hospitalFreeText) : null}
              required
            >
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid}
                  value={form.hospitalFreeText}
                  onChange={(e) => update({ hospitalFreeText: e.target.value })}
                />
              )}
            </Field>
          )}
        </div>

        {/* ---- Who is asking ---- */}
        <Field label={t('request.yourName')} error={errors.requesterName ? t(errors.requesterName) : null} required>
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              value={form.requesterName}
              onChange={(e) => update({ requesterName: e.target.value })}
              autoComplete="name"
            />
          )}
        </Field>

        <Field
          label={t('request.yourPhone')}
          hint={t('request.yourPhone.hint')}
          error={errors.requesterPhone ? t(errors.requesterPhone) : null}
          required
        >
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="01712345678"
              value={form.requesterPhone}
              onChange={(e) => update({ requesterPhone: e.target.value })}
            />
          )}
        </Field>

        <Field label={t('form.whatsapp')} error={errors.requesterWhatsapp ? t(errors.requesterWhatsapp) : null}>
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              type="tel"
              inputMode="tel"
              value={form.requesterWhatsapp}
              onChange={(e) => update({ requesterWhatsapp: e.target.value })}
            />
          )}
        </Field>

        <Field label={t('form.email')} hint={t('request.yourEmail.hint')}>
          {({ id }) => (
            <Input
              id={id}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.requesterEmail}
              onChange={(e) => update({ requesterEmail: e.target.value })}
            />
          )}
        </Field>

        <Field label={t('request.note')} hint={t('request.note.hint')}>
          {({ id }) => (
            <Textarea
              id={id}
              value={form.patientNote}
              onChange={(e) => update({ patientNote: e.target.value })}
              maxLength={500}
            />
          )}
        </Field>

        {failure && (
          <p role="alert" className="rounded-md border-2 border-line bg-shindur-fill px-3 py-2.5 text-sm font-bold text-tile-ink">
            {t(failure)}
          </p>
        )}

        <Button type="submit" variant="urgent" size="lg" disabled={submitting} block>
          {submitting ? t('request.sending') : t('request.submit')}
        </Button>

        <p className="text-sm text-muted">{t('request.privacy')}</p>
        <p className="text-sm font-bold">{t('footer.emergency')}</p>
      </form>
    </section>
  )
}

/**
 * The confirmation.
 *
 * It has to say a true number. "We have told 14 people" is worth something to
 * someone standing in a hospital; "Request submitted!" is worth nothing.
 *
 * When the master email switch is off, it says so plainly rather than implying
 * that messages went out.
 */
function RequestSent({ match }: { match: MatchOutcome | null }) {
  const { t, n } = useI18n()
  const count = match?.matched_count ?? 0

  return (
    <section className="mx-auto max-w-xl px-4 py-12 text-center">
      <h1 className="text-hero font-extrabold">{t('request.sent.title')}</h1>

      <div className="mt-6 rounded-lg border-2 border-line bg-raise p-6 shadow-ink-3">
        {count > 0 ? (
          <>
            <p className="text-5xl font-extrabold tabular-nums">{n(count)}</p>
            <p className="mt-2 font-bold">{t('request.sent.donorsFound', { count })}</p>
            {match?.widened ? (
              <p className="mt-1 text-sm text-muted">{t('request.sent.wholeDistrict')}</p>
            ) : match?.radius_km ? (
              <p className="mt-1 text-sm text-muted">
                {t('request.sent.withinKm', { km: n(match.radius_km) })}
              </p>
            ) : null}

            {match?.emails_queued === false && (
              <p className="mt-4 rounded-md border-2 border-line bg-gada-fill px-3 py-2 text-sm font-bold text-tile-ink">
                {t('request.sent.emailsOff')}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-extrabold">{t('request.sent.noneFound.title')}</p>
            <p className="mt-2 text-sm text-muted">{t('request.sent.noneFound.body')}</p>
          </>
        )}
      </div>

      <div className="mt-6 rounded-md border-2 border-line bg-sunk p-4 text-left text-sm">
        <h2 className="font-extrabold">{t('request.sent.next.title')}</h2>
        <ul className="mt-2 grid gap-1.5 text-muted">
          <li>{t('request.sent.next.1')}</li>
          <li>{t('request.sent.next.2')}</li>
          <li>{t('request.sent.next.3')}</li>
        </ul>
      </div>

      <ButtonLink to="/find" variant="secondary" size="lg" className="mt-6" block>
        {t('request.sent.alsoSearch')}
      </ButtonLink>

      <p className="mt-6 text-sm font-bold">{t('footer.emergency')}</p>
    </section>
  )
}
