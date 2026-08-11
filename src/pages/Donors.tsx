import { useEffect, useState } from 'react'
import { m } from '@/lib/motion'
import { useI18n } from '@/lib/i18n'
import { useReducedMotion } from '@/lib/hooks'
import { getSupabase } from '@/lib/supabase'
import { cacheGet, cacheSet } from '@/lib/cache'
import { splitGroup, tileColorVar, type BloodGroup } from '@/lib/blood'
import { ButtonLink } from '@/components/Button'

type WallRow = {
  id: string
  display_name: string
  blood_group: BloodGroup
  district_en: string | null
  district_bn: string | null
  total_donations: number
  verified: boolean
}

/**
 * The wall of donors.
 *
 * Only people who ticked consent_public_listing appear here, enforced by the
 * view itself, not by this component.
 *
 * The job of this page is to make appearing on it feel worth something. That
 * is why the donation count is the loudest thing on each card and why people
 * who have given most are at the top: it is the one place in the product where
 * a donor gets something back.
 */
export default function DonorsWall() {
  const { t, n, lang } = useI18n()
  const reduced = useReducedMotion()
  const [rows, setRows] = useState<WallRow[]>(() => cacheGet<WallRow[]>('wall')?.data ?? [])
  const [loading, setLoading] = useState(rows.length === 0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const pending = getSupabase()
      if (!pending) {
        if (!cancelled) setLoading(false)
        return
      }
      try {
        const supabase = await pending
        const { data, error } = await supabase.from('wall_of_donors').select('*').limit(200)
        if (error) throw error
        if (cancelled) return
        const list = (data ?? []) as WallRow[]
        cacheSet('wall', list)
        setRows(list)
      } catch {
        /* whatever was cached stays */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-hero font-extrabold">{t('page.wall.title')}</h1>
      <p className="mt-2 max-w-prose text-muted">{t('wall.intro')}</p>

      {loading && <p role="status" className="mt-6 text-muted">{t('common.loading')}</p>}

      {!loading && rows.length === 0 && (
        <div className="mt-8 rounded-lg border-2 border-line bg-raise p-8 text-center shadow-ink-2">
          <p className="text-lg font-extrabold">{t('wall.empty.title')}</p>
          <p className="mt-2 text-muted">{t('wall.empty.body')}</p>
          <ButtonLink to="/register" size="lg" className="mt-5">
            {t('wall.empty.action')}
          </ButtonLink>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((donor, index) => {
            const { letters, sign } = splitGroup(donor.blood_group)
            const district = lang === 'bn' ? donor.district_bn : donor.district_en
            return (
              <m.li
                key={donor.id}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduced
                    ? { duration: 0.15 }
                    : // Capped so the hundredth card is not four seconds late.
                      { duration: 0.3, delay: Math.min(index * 0.02, 0.4) }
                }
                className="ink-press flex items-center gap-3 rounded-md border-2 border-line bg-raise p-3 shadow-ink-1"
              >
                <span
                  aria-hidden="true"
                  className="flex size-12 shrink-0 flex-col items-center justify-center rounded-[10px] border-2 border-line text-tile-ink"
                  style={{ backgroundColor: tileColorVar(donor.blood_group) }}
                >
                  <span className="text-base leading-none font-extrabold">{letters}</span>
                  <span
                    className="rounded-sm bg-tile-ink px-1 text-[9px] leading-tight font-extrabold"
                    style={{ color: tileColorVar(donor.blood_group) }}
                  >
                    {sign === '+' ? '+' : '−'}
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate font-extrabold">{donor.display_name}</span>
                    <span className="sr-only">
                      {letters} {sign === '+' ? t('group.positive') : t('group.negative')}
                    </span>
                    {donor.verified && (
                      <span className="rounded-sm border-2 border-line bg-jol-fill px-1 text-[10px] font-bold text-tile-ink">
                        {t('search.verified')}
                      </span>
                    )}
                  </span>
                  {district && <span className="block truncate text-sm text-muted">{district}</span>}
                </span>

                {/* The number is the reward. It gets the largest type on the card. */}
                <span className="text-right">
                  <span className="block text-2xl leading-none font-extrabold tabular-nums">
                    {n(donor.total_donations)}
                  </span>
                  <span className="block text-[10px] font-bold text-muted">{t('wall.times')}</span>
                </span>
              </m.li>
            )
          })}
        </ul>
      )}

      <p className="mt-8 max-w-prose text-sm text-muted">{t('wall.privacy')}</p>
    </section>
  )
}
