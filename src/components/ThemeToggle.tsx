import { useI18n } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  const { t } = useI18n()

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('theme.toggle')}
      title={resolved === 'dark' ? t('theme.light') : t('theme.dark')}
      className="ink-press inline-flex size-9 items-center justify-center rounded-md border-2 border-line bg-raise text-ink shadow-ink-1"
    >
      {/* Flat shapes, no gradients: a filled disc for light, a cut disc for
          dark. Same silhouette in both states so the header does not jump. */}
      <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true" fill="currentColor">
        {resolved === 'dark' ? (
          <path d="M10 1.5a8.5 8.5 0 1 0 8.5 8.5A6.5 6.5 0 0 1 10 1.5Z" />
        ) : (
          <>
            <circle cx="10" cy="10" r="4.5" />
            <path d="M10 0h1.6v3.2H10zM10 16.8h1.6V20H10zM0 10v1.6h3.2V10zM16.8 10v1.6H20V10zM3 3l1.1-1.1 2.3 2.3L5.3 5.3zM13.6 13.6l1.1-1.1 2.3 2.3-1.1 1.1zM3 17l-1.1-1.1 2.3-2.3 1.1 1.1zM17 3l1.1 1.1-2.3 2.3-1.1-1.1z" />
          </>
        )}
      </svg>
    </button>
  )
}
