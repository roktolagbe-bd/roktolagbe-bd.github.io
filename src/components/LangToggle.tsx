import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/cn'

/**
 * Two words, both always visible, current one filled in.
 *
 * A globe icon would be smaller but it makes people guess. Someone who cannot
 * read the interface can still see the word "English" and tap it.
 */
export function LangToggle() {
  const { lang, setLang, t } = useI18n()

  return (
    <div
      className="inline-flex overflow-hidden rounded-md border-2 border-line"
      role="group"
      aria-label={t('lang.toggle')}
    >
      {(['bn', 'en'] as const).map((code) => {
        const active = lang === code
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLang(code)}
            aria-pressed={active}
            lang={code}
            className={cn(
              'min-h-9 px-2.5 text-sm font-bold transition-colors',
              active ? 'bg-ink text-surface' : 'bg-raise text-ink hover:bg-sunk',
            )}
          >
            {code === 'bn' ? 'বাংলা' : 'EN'}
          </button>
        )
      })}
    </div>
  )
}
