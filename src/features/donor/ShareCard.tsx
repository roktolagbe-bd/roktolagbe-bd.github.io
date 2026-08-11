import { useState } from 'react'
import { Confetti } from '@/components/Confetti'
import { Button, ButtonLink } from '@/components/Button'
import { useI18n } from '@/lib/i18n'
import { splitGroup, tileColorVar, type BloodGroup } from '@/lib/blood'

const SITE_URL = 'https://roktolagbe-bd.github.io'

/**
 * The moment after registering.
 *
 * Two jobs. Tell the person what happens next, so they are not left wondering
 * whether it worked. And give them something worth posting, because one donor
 * who shares this brings more donors than any amount of copywriting.
 *
 * The card shows a blood group and a district. It deliberately contains no
 * name and no phone number, so sharing it cannot leak anything.
 */
export function ShareCard({
  bloodGroup,
  districtName,
}: {
  bloodGroup: BloodGroup
  districtName: string | null
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const { letters, sign } = splitGroup(bloodGroup)

  const shareText = t('success.share.text', { group: bloodGroup })

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: t('brand.name'), text: shareText, url: SITE_URL })
        return
      } catch {
        // The user dismissed the sheet, or the browser refused. Fall through
        // to copying, which always works.
      }
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${SITE_URL}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="relative mx-auto max-w-lg px-4 py-10 text-center">
      <Confetti />

      <h1 className="text-hero font-extrabold">{t('success.title')}</h1>
      <p className="mt-3 text-muted">{t('success.body')}</p>

      {/* The shareable object. Same painted-block language as the grid. */}
      <div className="mt-8 rounded-lg border-2 border-line bg-raise p-6 shadow-ink-3">
        <div
          className="mx-auto flex size-28 flex-col items-center justify-center rounded-tile border-2 border-line text-tile-ink shadow-ink-2"
          style={{ backgroundColor: tileColorVar(bloodGroup) }}
        >
          <span aria-hidden="true" className="text-4xl leading-none font-extrabold">
            {letters}
          </span>
          <span
            aria-hidden="true"
            className="mt-1 rounded-sm bg-tile-ink px-1.5 text-sm leading-tight font-extrabold"
            style={{ color: tileColorVar(bloodGroup) }}
          >
            {sign === '+' ? '+' : '−'}
          </span>
        </div>

        <p className="mt-4 text-lg font-extrabold">{t('success.card.line1')}</p>
        {districtName && <p className="text-muted">{districtName}</p>}
        <p className="mt-4 text-sm text-muted">{SITE_URL.replace('https://', '')}</p>
      </div>

      <div className="mt-6 grid gap-3">
        <Button onClick={share} size="lg" block>
          {copied ? t('success.share.copied') : t('success.share.action')}
        </Button>
        <ButtonLink to="/" variant="secondary" size="lg" block>
          {t('success.home')}
        </ButtonLink>
      </div>

      <div className="mt-8 rounded-md border-2 border-line bg-sunk p-4 text-left text-sm">
        <h2 className="font-extrabold">{t('success.next.title')}</h2>
        <ul className="mt-2 grid gap-1.5 text-muted">
          <li>{t('success.next.1')}</li>
          <li>{t('success.next.2')}</li>
          <li>{t('success.next.3')}</li>
        </ul>
      </div>
    </section>
  )
}
