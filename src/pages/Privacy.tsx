import { useI18n, type TKey } from '@/lib/i18n'

const REPO = 'https://github.com/roktolagbe-bd/roktolagbe-bd.github.io'

/**
 * The promise, in the language the donor registered in.
 *
 * SECURITY.md is the full document and it is in English, aimed at people
 * reviewing the code. This page is the same promise in Bangla and English,
 * short enough that somebody actually reads it before typing their phone
 * number in, and it links to the file and to the exact migration that enforces
 * each claim.
 */
const PROMISES: Array<{ title: TKey; body: TKey }> = [
  { title: 'privacy.p1.title', body: 'privacy.p1.body' },
  { title: 'privacy.p2.title', body: 'privacy.p2.body' },
  { title: 'privacy.p3.title', body: 'privacy.p3.body' },
  { title: 'privacy.p4.title', body: 'privacy.p4.body' },
  { title: 'privacy.p5.title', body: 'privacy.p5.body' },
]

export default function Privacy() {
  const { t } = useI18n()

  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-hero font-extrabold">{t('page.privacy.title')}</h1>
      <p className="mt-3 text-lg text-muted">{t('privacy.intro')}</p>

      <ol className="mt-8 grid gap-3">
        {PROMISES.map((p, i) => (
          <li key={p.title} className="rounded-md border-2 border-line bg-raise p-4 shadow-ink-1">
            <h2 className="flex items-baseline gap-2 font-extrabold">
              <span
                aria-hidden="true"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm border-2 border-line bg-gada-fill text-xs text-tile-ink"
              >
                {i + 1}
              </span>
              {t(p.title)}
            </h2>
            <p className="mt-2 text-muted">{t(p.body)}</p>
          </li>
        ))}
      </ol>

      <div className="mt-10 rounded-md border-2 border-line bg-sunk p-5">
        <h2 className="font-extrabold">{t('privacy.check.title')}</h2>
        <p className="mt-2 text-sm text-muted">{t('privacy.check.body')}</p>
        <ul className="mt-3 grid gap-1.5 text-sm font-bold">
          <li>
            <a
              href={`${REPO}/blob/main/SECURITY.md`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-nil underline underline-offset-4"
            >
              SECURITY.md
            </a>
          </li>
          <li>
            <a
              href={`${REPO}/blob/main/supabase/migrations/0009_rls_policies.sql`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-nil underline underline-offset-4"
            >
              0009_rls_policies.sql
            </a>
          </li>
        </ul>
      </div>

      <p className="mt-8 text-sm">
        {t('privacy.contact')}{' '}
        <a href="mailto:roktolagbebd@gmail.com" className="text-nil underline underline-offset-4">
          roktolagbebd@gmail.com
        </a>
      </p>
    </section>
  )
}
