import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button'
import { Field } from '@/components/form/Field'
import { PhoneInput } from '@/components/form/PhoneInput'
import { useI18n } from '@/lib/i18n'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { callFunction } from '@/lib/functions'
import { Certificate, type CertificateRow } from '@/features/certificate/Certificate'

/**
 * /certificate/:token   the donor's own certificate
 * /certificate          the "I lost my link" form
 *
 * The token is the whole credential. There is deliberately no way to reach a
 * certificate by phone number, name or id: a lookup that answers "yes, that
 * number belongs to a donor" is a way to find people, and this site exists on
 * the promise that it is not one.
 *
 * Recovery therefore goes by email, and answers every number with the same
 * sentence whether it matched or not.
 */
export default function CertificatePage() {
  const { token } = useParams<{ token: string }>()
  const { t } = useI18n()

  const [row, setRow] = useState<CertificateRow | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>(
    token ? 'loading' : 'ready',
  )

  useEffect(() => {
    if (!token) return
    let cancelled = false

    void (async () => {
      const pending = getSupabase()
      if (!pending) {
        if (!cancelled) setState('missing')
        return
      }
      try {
        const supabase = await pending
        const { data, error } = await supabase
          .rpc('donor_certificate', { in_token: token })
          .maybeSingle()
        if (error) throw error
        if (cancelled) return
        if (!data) {
          setState('missing')
          return
        }
        setRow(data as CertificateRow)
        setState('ready')
      } catch {
        if (!cancelled) setState('missing')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token])

  if (token && state === 'loading') {
    return (
      <section className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-muted">{t('common.loading')}</p>
      </section>
    )
  }

  if (token && state === 'missing') {
    return (
      <section className="mx-auto max-w-lg px-4 py-12 text-center">
        <h1 className="text-hero font-extrabold">{t('certificate.notFound.title')}</h1>
        <p className="mt-3 text-muted">{t('certificate.notFound.body')}</p>
        <div className="mt-6 grid gap-3">
          <ButtonLink to="/certificate" size="lg" block>
            {t('certificate.recover.action')}
          </ButtonLink>
          <ButtonLink to="/register" variant="secondary" size="lg" block>
            {t('nav.register')}
          </ButtonLink>
        </div>
      </section>
    )
  }

  if (token && row) {
    return (
      <section className="mx-auto max-w-lg px-4 py-8">
        <h1 className="text-hero font-extrabold">{t('certificate.title')}</h1>
        <p className="mt-2 text-muted">{t('certificate.subtitle')}</p>
        <div className="mt-6">
          <Certificate row={row} />
        </div>
      </section>
    )
  }

  return <RecoverForm />
}

/**
 * The recovery form.
 *
 * Every outcome produces the same message. Not out of tidiness: if the wording
 * changed when a number matched, the form would become the phone-number oracle
 * the token was introduced to avoid.
 */
function RecoverForm() {
  const { t } = useI18n()
  const [phone, setPhone] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!phone.trim()) return
    setBusy(true)
    // The result is ignored on purpose. Whatever happened, the answer is the
    // same, and a different message for a different outcome would be the leak.
    await callFunction('certificate-link', { phone: phone.trim() }, 10_000)
    setBusy(false)
    setSent(true)
  }

  return (
    <section className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-hero font-extrabold">{t('certificate.recover.title')}</h1>
      <p className="mt-2 text-muted">{t('certificate.recover.body')}</p>

      {!isSupabaseConfigured && (
        <p role="status" className="mt-4 rounded-md border-2 border-line bg-gada-fill px-3 py-2 text-sm font-bold text-tile-ink">
          {t('request.error.notConfigured')}
        </p>
      )}

      {sent ? (
        <p
          role="status"
          className="mt-6 rounded-md border-2 border-line bg-jol-fill px-4 py-3 font-bold text-tile-ink"
        >
          {t('certificate.recover.sent')}
        </p>
      ) : (
        <form
          className="mt-6 grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          noValidate
        >
          <Field label={t('form.phone')} hint={t('certificate.recover.phoneHint')} required>
            {({ id, describedBy, invalid }) => (
              <PhoneInput
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={phone}
                onChange={setPhone}
                countryLabel={t('form.countryCode')}
              />
            )}
          </Field>

          <Button type="submit" disabled={busy} size="lg" block>
            {busy ? t('common.loading') : t('certificate.recover.action')}
          </Button>
        </form>
      )}

      <p className="mt-8 rounded-md border-2 border-line bg-sunk p-4 text-sm text-muted">
        {t('certificate.recover.why')}
      </p>
    </section>
  )
}
