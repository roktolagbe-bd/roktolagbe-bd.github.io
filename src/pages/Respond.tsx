import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button'
import { useI18n, type TKey } from '@/lib/i18n'
import { getSupabase } from '@/lib/supabase'
import { callFunction } from '@/lib/functions'
import { splitGroup, tileColorVar, type BloodGroup } from '@/lib/blood'

type RequestView = {
  request_id: string
  blood_group: BloodGroup
  units_needed: number
  urgency: 'critical' | 'urgent' | 'scheduled'
  hospital_name: string | null
  district_en: string | null
  district_bn: string | null
  needed_by: string | null
  patient_note: string | null
  requester_name: string
  distance_km: number | null
  already_responded: 'pending' | 'accepted' | 'declined'
}

type Accepted = {
  requester_name: string | null
  requester_phone: string | null
  requester_whatsapp: string | null
  hospital_name: string | null
}

const URGENCY: Record<string, TKey> = {
  critical: 'request.urgency.critical',
  urgent: 'request.urgency.urgent',
  scheduled: 'request.urgency.scheduled',
}

/**
 * The page a donor lands on from the link in their email.
 *
 * No login. The token in the URL is the whole credential: it is good for one
 * donor and one request, and it stops working when the request closes.
 *
 * Two buttons and nothing else above the fold. Someone reading this is
 * deciding whether to give blood to a stranger, not browsing.
 */
export default function Respond() {
  const { token = '' } = useParams()
  const [params] = useSearchParams()
  const { t, n, lang } = useI18n()

  const [request, setRequest] = useState<RequestView | null>(null)
  const [loading, setLoading] = useState(true)
  const [expired, setExpired] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<'accepted' | 'declined' | null>(null)
  const [accepted, setAccepted] = useState<Accepted | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const pending = getSupabase()
      if (!pending) {
        if (!cancelled) {
          setLoading(false)
          setExpired(true)
        }
        return
      }
      try {
        const supabase = await pending
        const { data, error } = await supabase
          .rpc('get_request_by_token', { in_token: token })
          .maybeSingle()
        if (error) throw error
        if (cancelled) return

        const row = data as RequestView | null
        if (!row) {
          setExpired(true)
        } else {
          setRequest(row)
          if (row.already_responded !== 'pending') {
            setOutcome(row.already_responded)
          }
        }
      } catch {
        if (!cancelled) setExpired(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const respond = async (accept: boolean) => {
    setSubmitting(true)
    setFailed(false)

    const result = await callFunction<{
      ok: boolean
      accepted?: boolean
      reason?: string
      requester_name?: string | null
      requester_phone?: string | null
      requester_whatsapp?: string | null
      hospital_name?: string | null
    }>('respond', { token, accept })

    setSubmitting(false)

    if (!result.ok) {
      setFailed(true)
      return
    }
    if (!result.data.ok) {
      setExpired(true)
      return
    }

    setOutcome(accept ? 'accepted' : 'declined')
    if (accept) {
      setAccepted({
        requester_name: result.data.requester_name ?? null,
        requester_phone: result.data.requester_phone ?? null,
        requester_whatsapp: result.data.requester_whatsapp ?? null,
        hospital_name: result.data.hospital_name ?? null,
      })
    }
  }

  // The email's buttons carry ?a=yes / ?a=no. We do NOT act on that
  // automatically: a mail client that prefetches links would answer on the
  // donor's behalf. It only preselects which button is emphasised.
  const leaning = params.get('a')

  if (loading) {
    return (
      <p role="status" className="mx-auto max-w-xl px-4 py-16 text-muted">
        {t('common.loading')}
      </p>
    )
  }

  if (expired) {
    return (
      <section className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-hero font-extrabold">{t('respond.expired.title')}</h1>
        <p className="mt-4 text-muted">{t('respond.expired.body')}</p>
        <ButtonLink to="/" size="lg" className="mt-6">
          {t('notfound.action')}
        </ButtonLink>
      </section>
    )
  }

  if (outcome === 'accepted') {
    return (
      <section className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-hero font-extrabold text-jol">{t('respond.accepted.title')}</h1>
        <p className="mt-3 text-muted">{t('respond.accepted.body')}</p>

        {accepted?.requester_phone && (
          <div className="mt-6 rounded-lg border-2 border-line bg-raise p-5 shadow-ink-2">
            <h2 className="font-extrabold">{t('respond.accepted.contact')}</h2>
            <p className="mt-1 text-lg font-extrabold">{accepted.requester_name}</p>
            {accepted.hospital_name && (
              <p className="text-sm text-muted">{accepted.hospital_name}</p>
            )}
            <div className="mt-4 grid gap-2">
              <a
                href={`tel:+${accepted.requester_phone}`}
                className="ink-press inline-flex min-h-12 items-center justify-center rounded-md border-2 border-line bg-nil px-5 font-bold text-on-nil no-underline shadow-ink-2"
              >
                {t('respond.call', { phone: accepted.requester_phone.replace(/^88/, '') })}
              </a>
              {accepted.requester_whatsapp && (
                <a
                  href={`https://wa.me/${accepted.requester_whatsapp}`}
                  rel="noreferrer noopener"
                  target="_blank"
                  className="ink-press inline-flex min-h-12 items-center justify-center rounded-md border-2 border-line bg-raise px-5 font-bold no-underline shadow-ink-2"
                >
                  {t('respond.whatsapp')}
                </a>
              )}
            </div>
          </div>
        )}

        <p className="mt-6 text-sm font-bold">{t('footer.emergency')}</p>
      </section>
    )
  }

  if (outcome === 'declined') {
    return (
      <section className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-hero font-extrabold">{t('respond.declined.title')}</h1>
        <p className="mt-4 text-muted">{t('respond.declined.body')}</p>
        <ButtonLink to="/" variant="secondary" size="lg" className="mt-6">
          {t('notfound.action')}
        </ButtonLink>
      </section>
    )
  }

  if (!request) return null

  const { letters, sign } = splitGroup(request.blood_group)
  const district = lang === 'bn' ? request.district_bn : request.district_en
  const when = request.needed_by
    ? new Date(request.needed_by).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
        day: 'numeric',
        month: 'long',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  return (
    <section className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-hero font-extrabold">{t('respond.title')}</h1>

      <div className="mt-6 flex items-center gap-4 rounded-lg border-2 border-line bg-raise p-5 shadow-ink-2">
        <span
          aria-hidden="true"
          className="flex size-20 shrink-0 flex-col items-center justify-center rounded-tile border-2 border-line text-tile-ink"
          style={{ backgroundColor: tileColorVar(request.blood_group) }}
        >
          <span className="text-2xl leading-none font-extrabold">{letters}</span>
          <span
            className="mt-1 rounded-sm bg-tile-ink px-1.5 text-xs font-extrabold"
            style={{ color: tileColorVar(request.blood_group) }}
          >
            {sign === '+' ? '+' : '−'}
          </span>
        </span>
        <div>
          <p className="text-lg font-extrabold">
            {t('respond.needs', { group: request.blood_group, units: request.units_needed })}
          </p>
          <p className="text-sm font-bold text-shindur">{t(URGENCY[request.urgency] ?? 'request.urgency.urgent')}</p>
        </div>
      </div>

      <dl className="mt-4 grid gap-2 rounded-md border-2 border-line bg-raise p-4 text-sm shadow-ink-1">
        <Row label={t('request.hospital')} value={request.hospital_name} />
        <Row label={t('form.district')} value={district} />
        {when && <Row label={t('request.neededBy')} value={when} />}
        {request.distance_km != null && (
          <Row label={t('search.radius')} value={t('search.away', { km: n(request.distance_km) })} />
        )}
        <Row label={t('request.yourName')} value={request.requester_name} />
      </dl>

      {request.patient_note && (
        <p className="mt-4 border-l-4 border-line bg-sunk p-3 text-sm">{request.patient_note}</p>
      )}

      <p className="mt-6 font-bold">{t('respond.question')}</p>
      <p className="mt-1 text-sm text-muted">{t('respond.explain')}</p>

      {failed && (
        <p role="alert" className="mt-4 rounded-md border-2 border-line bg-shindur-fill px-3 py-2 text-sm font-bold text-tile-ink">
          {t('respond.failed')}
        </p>
      )}

      <div className="mt-4 grid gap-3">
        <Button
          onClick={() => void respond(true)}
          disabled={submitting}
          size="lg"
          block
          className={leaning === 'no' ? 'opacity-90' : undefined}
        >
          {submitting ? t('register.submitting') : t('respond.accept')}
        </Button>
        <Button
          onClick={() => void respond(false)}
          disabled={submitting}
          variant="secondary"
          size="lg"
          block
        >
          {t('respond.decline')}
        </Button>
      </div>

      <p className="mt-6 text-sm text-muted">{t('respond.privacy')}</p>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-muted">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  )
}
