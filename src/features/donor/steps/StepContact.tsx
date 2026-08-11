import { Field, Input, Checkbox } from '@/components/form/Field'
import { useI18n } from '@/lib/i18n'
import type { StepProps } from '../types'

export function StepContact({ form, errors, update }: StepProps) {
  const { t } = useI18n()

  return (
    <div className="grid gap-5">
      {/* Said before anything is typed, not buried in a privacy policy. This is
          the screen where people decide whether to trust the site. */}
      <p className="rounded-md border-2 border-line bg-jol-fill px-3 py-2.5 text-sm font-bold text-tile-ink">
        {t('form.contact.promise')}
      </p>

      <Field
        label={t('form.phone')}
        hint={t('form.phone.hint')}
        error={errors.phone ? t(errors.phone) : null}
        required
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.phone}
            onChange={(e) => update({ phone: e.target.value })}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="01712345678"
            enterKeyHint="next"
          />
        )}
      </Field>

      <Field
        label={t('form.whatsapp')}
        hint={t('form.whatsapp.hint')}
        error={errors.whatsapp ? t(errors.whatsapp) : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.whatsapp}
            onChange={(e) => update({ whatsapp: e.target.value })}
            type="tel"
            inputMode="tel"
            placeholder="01712345678"
          />
        )}
      </Field>

      <Checkbox
        checked={form.consentEmail}
        onChange={(e) => update({ consentEmail: e.target.checked })}
        label={t('form.consent.email')}
        hint={t('form.consent.email.hint')}
      />

      <Field
        label={t('form.email')}
        hint={form.consentEmail ? t('form.email.hint') : t('form.email.hint.optional')}
        error={errors.email ? t(errors.email) : null}
        required={form.consentEmail}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.email}
            onChange={(e) => update({ email: e.target.value })}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="name@example.com"
          />
        )}
      </Field>

      <Field
        label={t('form.facebook')}
        hint={t('form.facebook.hint')}
        error={errors.facebookUrl ? t(errors.facebookUrl) : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.facebookUrl}
            onChange={(e) => update({ facebookUrl: e.target.value })}
            type="url"
            inputMode="url"
            placeholder="https://facebook.com/..."
          />
        )}
      </Field>
    </div>
  )
}
