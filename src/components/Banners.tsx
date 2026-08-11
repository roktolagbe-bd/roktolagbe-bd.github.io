import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { useOnline } from '@/lib/hooks'
import { isSupabaseConfigured } from '@/lib/supabase'

/**
 * Offline is a state, not an error.
 *
 * A blank page with a spinner looks broken and makes people leave. This says
 * what happened in one line, stays out of the way, and confirms when the
 * connection comes back so the user knows to try again.
 */
export function OfflineBanner() {
  const { t } = useI18n()
  const online = useOnline()
  const [showBack, setShowBack] = useState(false)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    if (!online) {
      setWasOffline(true)
      setShowBack(false)
      return
    }
    if (wasOffline) {
      setShowBack(true)
      const timer = setTimeout(() => setShowBack(false), 4000)
      return () => clearTimeout(timer)
    }
  }, [online, wasOffline])

  if (online && !showBack) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        online
          ? 'border-b-2 border-line bg-jol-fill px-4 py-2 text-center text-sm font-bold text-tile-ink'
          : 'border-b-2 border-line bg-gada-fill px-4 py-2 text-sm font-bold text-tile-ink'
      }
    >
      {online ? (
        t('offline.back')
      ) : (
        <span className="mx-auto block max-w-6xl">
          <strong>{t('offline.title')}</strong> {t('offline.body')}
        </span>
      )}
    </div>
  )
}

/**
 * Shown only when the site was built without Supabase credentials, which is
 * exactly what happens on the very first deploy. Better to say so than to let
 * a volunteer think the numbers on the landing page are real.
 */
export function ConfigBanner() {
  const { t } = useI18n()
  if (isSupabaseConfigured) return null

  return (
    <div
      role="status"
      className="border-b-2 border-line bg-sunk px-4 py-2 text-sm"
    >
      <span className="mx-auto block max-w-6xl">
        <strong className="font-bold">{t('config.missing.title')}</strong>{' '}
        <span className="text-muted">{t('config.missing.body')}</span>
      </span>
    </div>
  )
}
