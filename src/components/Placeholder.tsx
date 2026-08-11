import type { ReactNode } from 'react'
import { useI18n, type TKey } from '@/lib/i18n'

/**
 * A page that is routed and reachable but not built yet.
 *
 * It exists so Phase 1 can prove that every route resolves on GitHub Pages,
 * including on a hard refresh of a deep link. Each phase replaces these with
 * the real thing.
 */
export function Placeholder({ titleKey, children }: { titleKey: TKey; children?: ReactNode }) {
  const { t } = useI18n()
  return (
    <section className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-hero font-extrabold">{t(titleKey)}</h1>
      <p className="mt-4 max-w-prose text-muted">{t('common.comingSoon')}</p>
      {children}
    </section>
  )
}
