import { useI18n, type TKey } from '@/lib/i18n'
import { ButtonLink } from '@/components/Button'

/**
 * Plain, honest content about giving blood.
 *
 * Written to answer the things that actually stop people in Bangladesh, which
 * are mostly fears rather than facts: that it makes you weak, that the needle
 * is dangerous, that your group is useless. No statistics nobody can check, no
 * cheerful marketing, no photographs of smiling models.
 */

const SECTIONS: Array<{ title: TKey; items: TKey[] }> = [
  { title: 'learn.who.title', items: ['learn.who.1', 'learn.who.2', 'learn.who.3', 'learn.who.4'] },
  {
    title: 'learn.what.title',
    items: ['learn.what.1', 'learn.what.2', 'learn.what.3', 'learn.what.4'],
  },
  {
    title: 'learn.after.title',
    items: ['learn.after.1', 'learn.after.2', 'learn.after.3'],
  },
]

const MYTHS: Array<{ myth: TKey; truth: TKey }> = [
  { myth: 'learn.myth.1', truth: 'learn.truth.1' },
  { myth: 'learn.myth.2', truth: 'learn.truth.2' },
  { myth: 'learn.myth.3', truth: 'learn.truth.3' },
  { myth: 'learn.myth.4', truth: 'learn.truth.4' },
  { myth: 'learn.myth.5', truth: 'learn.truth.5' },
]

export default function Learn() {
  const { t } = useI18n()

  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-hero font-extrabold">{t('page.learn.title')}</h1>
      <p className="mt-3 text-lg text-muted">{t('learn.intro')}</p>

      {SECTIONS.map((section) => (
        <div key={section.title} className="mt-10">
          <h2 className="text-2xl font-extrabold">{t(section.title)}</h2>
          <ul className="mt-3 grid gap-2">
            {section.items.map((item) => (
              <li
                key={item}
                className="rounded-md border-2 border-line bg-raise px-4 py-3 shadow-ink-1"
              >
                {t(item)}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="mt-12">
        <h2 className="text-2xl font-extrabold">{t('learn.myths.title')}</h2>
        <dl className="mt-3 grid gap-3">
          {MYTHS.map((row) => (
            <div key={row.myth} className="rounded-md border-2 border-line bg-raise shadow-ink-1">
              <dt className="border-b-2 border-line px-4 py-2.5 font-bold">
                <span className="mr-2 rounded-sm border-2 border-line bg-shindur-fill px-1.5 text-xs text-tile-ink">
                  {t('learn.myth')}
                </span>
                {t(row.myth)}
              </dt>
              <dd className="px-4 py-3 text-muted">
                <span className="mr-2 rounded-sm border-2 border-line bg-jol-fill px-1.5 text-xs font-bold text-tile-ink">
                  {t('learn.truth')}
                </span>
                {t(row.truth)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-12 rounded-lg border-2 border-line bg-raise p-6 shadow-ink-2">
        <h2 className="text-xl font-extrabold">{t('learn.cta.title')}</h2>
        <p className="mt-2 text-muted">{t('learn.cta.body')}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink to="/eligibility" variant="secondary" size="lg">
            {t('nav.eligibility')}
          </ButtonLink>
          <ButtonLink to="/register" size="lg">
            {t('home.cta.register.action')}
          </ButtonLink>
        </div>
      </div>

      <p className="mt-8 text-sm font-bold">{t('learn.disclaimer')}</p>
    </section>
  )
}
