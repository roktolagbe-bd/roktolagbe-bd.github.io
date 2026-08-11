import { useI18n } from '@/lib/i18n'
import { ButtonLink } from '@/components/Button'

export default function NotFound() {
  const { t } = useI18n()
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-hero font-extrabold">{t('notfound.title')}</h1>
      <p className="mt-4 max-w-prose text-muted">{t('notfound.body')}</p>
      <ButtonLink to="/" size="lg" className="mt-6">
        {t('notfound.action')}
      </ButtonLink>
    </section>
  )
}
