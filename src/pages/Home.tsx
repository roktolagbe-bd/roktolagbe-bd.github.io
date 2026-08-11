import { m } from '@/lib/motion'
import { useI18n, type TKey } from '@/lib/i18n'
import { useReducedMotion } from '@/lib/hooks'
import { BloodGrid } from '@/components/BloodGrid'
import { CountUp } from '@/components/CountUp'
import { ButtonLink } from '@/components/Button'
import { useSiteStats } from '@/features/home/useSiteStats'

/* The page load sequence. Three beats: the question, the answer, everything
   else. It runs once, it is short, and it disappears entirely under
   prefers-reduced-motion. */
function useEntrance() {
  const reduced = useReducedMotion()
  return (delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.4, delay, ease: [0.2, 0.8, 0.2, 1] as const },
        }
}

export default function Home() {
  const { t } = useI18n()
  const { stats, loading } = useSiteStats()
  const entrance = useEntrance()

  return (
    <>
      {/* ---- The question, and the answer directly under it ---------------- */}
      <section className="mx-auto max-w-6xl px-4 pt-8 pb-4 sm:pt-14">
        <m.h1
          {...entrance(0)}
          lang="bn"
          className="text-display max-w-[14ch] font-extrabold"
        >
          {t('home.hero.question')}
        </m.h1>

        <m.p {...entrance(0.08)} className="mt-4 max-w-lg text-lg text-muted sm:text-xl">
          {t('home.hero.answer')}
        </m.p>

        <m.div {...entrance(0.16)} className="mt-6 sm:mt-8">
          <BloodGrid data={stats.byGroup} loading={loading} />
        </m.div>

        <m.div {...entrance(0.3)} className="mt-6 flex flex-wrap gap-3">
          <ButtonLink to="/request" variant="urgent" size="lg">
            {t('home.cta.urgent')}
          </ButtonLink>
          <ButtonLink to="/register" variant="secondary" size="lg">
            {t('home.cta.register.action')}
          </ButtonLink>
        </m.div>
      </section>

      {/* ---- Live counters ------------------------------------------------- */}
      <section
        aria-label={t('home.stats.label')}
        className="mx-auto mt-10 max-w-6xl px-4"
      >
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat labelKey="home.stats.donors" value={stats.donors} />
          <Stat labelKey="home.stats.fulfilled" value={stats.fulfilled} />
          <Stat labelKey="home.stats.districts" value={stats.districts} />
        </dl>
      </section>

      {/* ---- How it works, in three plain sentences ------------------------ */}
      <section className="mx-auto mt-16 max-w-6xl px-4">
        <h2 className="text-hero font-extrabold">{t('home.how.title')}</h2>
        <ol className="mt-6 grid gap-3 sm:grid-cols-3">
          <Step n={1} titleKey="home.how.1.title" bodyKey="home.how.1.body" />
          <Step n={2} titleKey="home.how.2.title" bodyKey="home.how.2.body" />
          <Step n={3} titleKey="home.how.3.title" bodyKey="home.how.3.body" />
        </ol>
      </section>

      {/* ---- One clear ask -------------------------------------------------- */}
      <section className="mx-auto mt-16 max-w-6xl px-4">
        <div className="ink-block rounded-lg p-6 sm:p-10">
          <h2 className="text-hero max-w-[18ch] font-extrabold">
            {t('home.cta.register.title')}
          </h2>
          <p className="mt-3 max-w-lg text-muted">{t('home.cta.register.body')}</p>
          <ButtonLink to="/register" size="lg" className="mt-6">
            {t('home.cta.register.action')}
          </ButtonLink>
        </div>
      </section>
    </>
  )
}

function Stat({ labelKey, value }: { labelKey: TKey; value: number }) {
  const { t } = useI18n()
  return (
    <div className="rounded-md border-2 border-line bg-raise px-3 py-4 shadow-ink-1 sm:px-4 sm:py-5">
      <dt className="text-xs font-bold text-muted sm:text-sm">{t(labelKey)}</dt>
      <dd className="mt-1 text-2xl font-extrabold tabular-nums sm:text-4xl">
        <CountUp value={value} />
      </dd>
    </div>
  )
}

function Step({ n, titleKey, bodyKey }: { n: number; titleKey: TKey; bodyKey: TKey }) {
  const { t, n: num } = useI18n()
  return (
    <li className="rounded-md border-2 border-line bg-raise p-5 shadow-ink-1">
      <span
        aria-hidden="true"
        className="inline-flex size-8 items-center justify-center rounded-sm border-2 border-line bg-gada-fill text-sm font-extrabold text-tile-ink"
      >
        {num(n)}
      </span>
      <h3 className="mt-3 text-lg font-extrabold">{t(titleKey)}</h3>
      <p className="mt-1.5 text-sm text-muted">{t(bodyKey)}</p>
    </li>
  )
}
