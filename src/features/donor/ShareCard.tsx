import { Confetti } from '@/components/Confetti'
import { ButtonLink } from '@/components/Button'
import { useI18n } from '@/lib/i18n'
import { type BloodGroup } from '@/lib/blood'
import { Certificate, type CertificateRow } from '@/features/certificate/Certificate'

const SITE_URL = 'https://roktolagbe-bd.github.io'

/**
 * The moment after registering.
 *
 * Two jobs. Tell the person what happens next, so they are not left wondering
 * whether it worked. And hand them something worth posting, because one donor
 * who shares this brings more donors than any amount of copywriting.
 *
 * The certificate is built from what was just typed rather than fetched back.
 * Everything on it is already here, and asking the database for it would fail
 * anyway: anon may insert and may not select.
 */
export function ShareCard({
  fullName,
  bloodGroup,
  areaName,
  districtName,
  certificateToken,
}: {
  fullName: string
  bloodGroup: BloodGroup
  areaName: string | null
  districtName: string | null
  certificateToken: string
}) {
  const { t } = useI18n()

  const row: CertificateRow = {
    full_name: fullName,
    display_name: fullName.trim().split(' ')[0] ?? fullName,
    blood_group: bloodGroup,
    area_name: areaName,
    // The same string in both slots: at this moment we have the district in
    // whichever language the form was filled in, not the pair.
    district_en: districtName,
    district_bn: districtName,
    total_donations: 0,
    verified: false,
    joined_month: new Date().toISOString().slice(0, 7),
  }

  return (
    <section className="relative mx-auto max-w-lg px-4 py-10">
      <Confetti />

      <div className="text-center">
        <h1 className="text-hero font-extrabold">{t('success.title')}</h1>
        <p className="mt-3 text-muted">{t('success.body')}</p>
      </div>

      <div className="mt-8">
        <Certificate row={row} shareUrl={`${SITE_URL}/certificate/${certificateToken}`} />
      </div>

      <div className="mt-6">
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
