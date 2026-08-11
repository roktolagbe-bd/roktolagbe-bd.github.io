import { Field, Input, Checkbox } from '@/components/form/Field'
import { useI18n } from '@/lib/i18n'
import { MIN_AGE, MAX_AGE, MIN_WEIGHT_KG, nextEligibleDate, yearsSince } from '../validation'
import type { StepProps } from '../types'

export function StepEligibility({ form, errors, update }: StepProps) {
  const { t, n, lang } = useI18n()

  const age = yearsSince(form.dateOfBirth)
  const waitUntil = form.lastDonationDate ? nextEligibleDate(form.lastDonationDate) : null
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="grid gap-5">
      <Field
        label={t('form.dob')}
        hint={t('form.dob.hint', { min: n(MIN_AGE), max: n(MAX_AGE) })}
        error={errors.dateOfBirth ? t(errors.dateOfBirth) : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.dateOfBirth}
            onChange={(e) => update({ dateOfBirth: e.target.value })}
            type="date"
            max={today}
            autoComplete="bday"
          />
        )}
      </Field>

      {age != null && age >= MIN_AGE && age <= MAX_AGE && (
        <p className="-mt-3 text-sm text-pata">{t('form.dob.ok', { age: n(age) })}</p>
      )}

      <Field
        label={t('form.weight')}
        hint={t('form.weight.hint', { min: n(MIN_WEIGHT_KG) })}
        error={errors.weightKg ? t(errors.weightKg) : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.weightKg}
            onChange={(e) => update({ weightKg: e.target.value })}
            type="number"
            inputMode="decimal"
            min={30}
            max={250}
          />
        )}
      </Field>

      <Field
        label={t('form.lastDonation')}
        hint={t('form.lastDonation.hint')}
        error={errors.lastDonationDate ? t(errors.lastDonationDate) : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.lastDonationDate}
            onChange={(e) => update({ lastDonationDate: e.target.value })}
            type="date"
            max={today}
          />
        )}
      </Field>

      {/* Not a rejection. Register now, be contacted when the cooldown ends. */}
      {waitUntil && (
        <p className="-mt-3 rounded-md border-2 border-line bg-gada-fill px-3 py-2 text-sm font-bold text-tile-ink">
          {t('form.lastDonation.wait', {
            date: waitUntil.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })}
        </p>
      )}

      <div className="grid gap-3">
        <Checkbox
          checked={form.consentPublicListing}
          onChange={(e) => update({ consentPublicListing: e.target.checked })}
          label={t('form.consent.listing')}
          hint={t('form.consent.listing.hint')}
        />

        <Checkbox
          checked={form.confirmEligible}
          onChange={(e) => update({ confirmEligible: e.target.checked })}
          label={t('form.consent.eligible')}
          hint={t('form.consent.eligible.hint')}
        />
        {errors.confirmEligible && (
          <p role="alert" className="text-sm font-bold text-shindur">
            {t(errors.confirmEligible)}
          </p>
        )}
      </div>
    </div>
  )
}
