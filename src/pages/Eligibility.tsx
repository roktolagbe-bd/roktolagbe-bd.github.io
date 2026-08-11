import { useState } from 'react'
import { Field, Input, Checkbox } from '@/components/form/Field'
import { ButtonLink, Button } from '@/components/Button'
import { useI18n, type TKey } from '@/lib/i18n'
import { MIN_AGE, MAX_AGE, MIN_WEIGHT_KG, COOLDOWN_DAYS, daysSince, yearsSince } from '@/features/donor/validation'

type Answers = {
  dob: string
  weight: string
  lastDonation: string
  recentIllness: boolean
  recentTattoo: boolean
  onMedication: boolean
}

type Verdict =
  | { kind: 'yes' }
  | { kind: 'no'; reason: TKey }
  | { kind: 'wait'; reason: TKey; until: Date }

/**
 * Six questions, one honest answer.
 *
 * The three answers are yes, no, and wait until a date. "Wait" is the one that
 * matters most: it is the difference between someone leaving thinking they are
 * useless, and someone registering today knowing they will be asked in March.
 *
 * This is guidance, not a medical clearance. The hospital screens every donor
 * again before drawing blood, and the page says so rather than implying it has
 * authority it does not have.
 */
function assess(a: Answers): Verdict | null {
  const age = yearsSince(a.dob)
  const weight = Number(a.weight)

  if (a.dob && age != null && age < MIN_AGE) return { kind: 'no', reason: 'eligibility.no.age' }
  if (a.dob && age != null && age > MAX_AGE) return { kind: 'no', reason: 'eligibility.no.old' }
  if (a.weight && (Number.isNaN(weight) || weight < MIN_WEIGHT_KG)) {
    return { kind: 'no', reason: 'eligibility.no.weight' }
  }

  const addDays = (from: string, days: number) => {
    const d = new Date(from)
    d.setDate(d.getDate() + days)
    return d
  }

  if (a.lastDonation) {
    const days = daysSince(a.lastDonation)
    if (days != null && days < COOLDOWN_DAYS) {
      return {
        kind: 'wait',
        reason: 'eligibility.wait.cooldown',
        until: addDays(a.lastDonation, COOLDOWN_DAYS),
      }
    }
  }

  // Conservative windows, in line with what Bangladeshi blood banks ask.
  if (a.recentIllness) {
    return { kind: 'wait', reason: 'eligibility.wait.illness', until: addDays(new Date().toISOString(), 14) }
  }
  if (a.recentTattoo) {
    return { kind: 'wait', reason: 'eligibility.wait.tattoo', until: addDays(new Date().toISOString(), 365) }
  }
  if (a.onMedication) return { kind: 'no', reason: 'eligibility.no.medication' }

  if (!a.dob || !a.weight) return null
  return { kind: 'yes' }
}

export default function Eligibility() {
  const { t, n, lang } = useI18n()
  const [a, setA] = useState<Answers>({
    dob: '',
    weight: '',
    lastDonation: '',
    recentIllness: false,
    recentTattoo: false,
    onMedication: false,
  })
  const [checked, setChecked] = useState(false)

  const verdict = checked ? assess(a) : null
  const set = (patch: Partial<Answers>) => setA((prev) => ({ ...prev, ...patch }))
  const today = new Date().toISOString().slice(0, 10)
  const fmt = (d: Date) =>
    d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

  return (
    <section className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-hero font-extrabold">{t('page.eligibility.title')}</h1>
      <p className="mt-2 text-muted">{t('eligibility.intro')}</p>

      <div className="mt-6 grid gap-5">
        <Field label={t('form.dob')} hint={t('form.dob.hint', { min: n(MIN_AGE), max: n(MAX_AGE) })}>
          {({ id }) => (
            <Input id={id} type="date" max={today} value={a.dob} onChange={(e) => set({ dob: e.target.value })} />
          )}
        </Field>

        <Field label={t('form.weight')} hint={t('form.weight.hint', { min: n(MIN_WEIGHT_KG) })}>
          {({ id }) => (
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              value={a.weight}
              onChange={(e) => set({ weight: e.target.value })}
            />
          )}
        </Field>

        <Field label={t('form.lastDonation')} hint={t('form.lastDonation.hint')}>
          {({ id }) => (
            <Input
              id={id}
              type="date"
              max={today}
              value={a.lastDonation}
              onChange={(e) => set({ lastDonation: e.target.value })}
            />
          )}
        </Field>

        <Checkbox
          checked={a.recentIllness}
          onChange={(e) => set({ recentIllness: e.target.checked })}
          label={t('eligibility.q.illness')}
          hint={t('eligibility.q.illness.hint')}
        />
        <Checkbox
          checked={a.recentTattoo}
          onChange={(e) => set({ recentTattoo: e.target.checked })}
          label={t('eligibility.q.tattoo')}
          hint={t('eligibility.q.tattoo.hint')}
        />
        <Checkbox
          checked={a.onMedication}
          onChange={(e) => set({ onMedication: e.target.checked })}
          label={t('eligibility.q.medication')}
          hint={t('eligibility.q.medication.hint')}
        />

        <Button size="lg" onClick={() => setChecked(true)}>
          {t('eligibility.check')}
        </Button>
      </div>

      {checked && !verdict && (
        <p role="status" className="mt-6 rounded-md border-2 border-line bg-sunk px-4 py-3 text-sm font-bold">
          {t('eligibility.needMore')}
        </p>
      )}

      {verdict && (
        <div
          role="status"
          className={
            verdict.kind === 'yes'
              ? 'mt-6 rounded-lg border-2 border-line bg-jol-fill p-5 shadow-ink-2 text-tile-ink'
              : verdict.kind === 'wait'
                ? 'mt-6 rounded-lg border-2 border-line bg-gada-fill p-5 shadow-ink-2 text-tile-ink'
                : 'mt-6 rounded-lg border-2 border-line bg-shindur-fill p-5 shadow-ink-2 text-tile-ink'
          }
        >
          <h2 className="text-xl font-extrabold">
            {verdict.kind === 'yes'
              ? t('eligibility.yes.title')
              : verdict.kind === 'wait'
                ? t('eligibility.wait.title', { date: fmt(verdict.until) })
                : t('eligibility.no.title')}
          </h2>
          {verdict.kind !== 'yes' && <p className="mt-2">{t(verdict.reason)}</p>}
          {verdict.kind === 'yes' && <p className="mt-2">{t('eligibility.yes.body')}</p>}

          {/* "Wait" still ends in registering. Someone eligible in March is
              worth having on the list today. */}
          {verdict.kind !== 'no' && (
            <ButtonLink to="/register" size="lg" className="mt-4">
              {t('home.cta.register.action')}
            </ButtonLink>
          )}
        </div>
      )}

      <p className="mt-8 text-sm font-bold">{t('eligibility.disclaimer')}</p>
    </section>
  )
}
