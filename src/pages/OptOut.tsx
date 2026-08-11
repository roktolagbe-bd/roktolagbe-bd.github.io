import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ButtonLink } from '@/components/Button'
import { useI18n } from '@/lib/i18n'
import { getSupabase } from '@/lib/supabase'

/**
 * One tap from any email, and the emails stop.
 *
 * It acts immediately on load rather than showing a confirmation screen. A
 * "are you sure you want to leave?" step is a dark pattern, and somebody who
 * clicked this has already decided.
 *
 * It switches off both consents: no more emails, and no more public listing.
 * The row is kept so their donation history survives, and so a future
 * registration with the same number is recognised rather than rejected as a
 * duplicate.
 */
export default function OptOut() {
  const { token = '' } = useParams()
  const { t } = useI18n()
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const pending = getSupabase()
      if (!pending) {
        if (!cancelled) setState('failed')
        return
      }
      try {
        const supabase = await pending
        const { data, error } = await supabase.rpc('opt_out_donor', { in_token: token })
        if (error) throw error
        if (!cancelled) setState(data === true ? 'done' : 'failed')
      } catch {
        if (!cancelled) setState('failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <section className="mx-auto max-w-xl px-4 py-16">
      {state === 'working' && (
        <p role="status" className="text-muted">
          {t('common.loading')}
        </p>
      )}

      {state === 'done' && (
        <>
          <h1 className="text-hero font-extrabold">{t('optout.done.title')}</h1>
          <p className="mt-4 text-muted">{t('optout.done.body')}</p>
          <ButtonLink to="/register" variant="secondary" size="lg" className="mt-6">
            {t('optout.done.rejoin')}
          </ButtonLink>
        </>
      )}

      {state === 'failed' && (
        <>
          <h1 className="text-hero font-extrabold">{t('optout.failed.title')}</h1>
          <p className="mt-4 text-muted">{t('optout.failed.body')}</p>
          <p className="mt-2 text-muted">
            <a href="mailto:roktolagbe.bd@gmail.com" className="text-nil underline underline-offset-4">
              roktolagbe.bd@gmail.com
            </a>
          </p>
        </>
      )}
    </section>
  )
}
