import { splitGroup, tileColorVar } from '@/lib/blood'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/cn'
import type { DonorResult } from './useDonorSearch'

/**
 * One search result.
 *
 * Everything shown here comes from a view with no contact columns, so there is
 * no way for this component to leak a phone number even by mistake. There is
 * deliberately no "call" button: contact details are released when a donor
 * accepts a request, and the way to reach someone is to make one.
 */
export function DonorCard({ donor }: { donor: DonorResult }) {
  const { t, n, lang } = useI18n()
  const { letters, sign } = splitGroup(donor.blood_group)

  const area = [
    lang === 'bn' ? donor.upazila_bn : donor.upazila_en,
    lang === 'bn' ? donor.district_bn : donor.district_en,
  ]
    .filter(Boolean)
    .join(', ')

  const lastDonation = donor.last_donation_month
    ? new Date(`${donor.last_donation_month}-01`).toLocaleDateString(
        lang === 'bn' ? 'bn-BD' : 'en-GB',
        { month: 'long', year: 'numeric' },
      )
    : null

  return (
    <li className="flex gap-3 rounded-md border-2 border-line bg-raise p-3 shadow-ink-1">
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 flex-col items-center justify-center rounded-[12px] border-2 border-line text-tile-ink"
        style={{ backgroundColor: tileColorVar(donor.blood_group) }}
      >
        <span className="text-lg leading-none font-extrabold">{letters}</span>
        <span
          className="mt-0.5 rounded-sm bg-tile-ink px-1 text-[10px] leading-tight font-extrabold"
          style={{ color: tileColorVar(donor.blood_group) }}
        >
          {sign === '+' ? '+' : '−'}
        </span>
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-base font-extrabold">{donor.display_name}</h3>
          <span className="sr-only">
            {letters} {sign === '+' ? t('group.positive') : t('group.negative')}
          </span>
          {donor.verified && (
            <span className="rounded-sm border-2 border-line bg-jol-fill px-1.5 text-xs font-bold text-tile-ink">
              {t('search.verified')}
            </span>
          )}
        </div>

        {area && <p className="text-sm text-muted">{area}</p>}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {/* Availability is a word, not a colour. */}
          <span
            className={cn('font-bold', donor.is_available ? 'text-pata' : 'text-muted')}
          >
            {donor.is_available ? t('search.available') : t('search.resting')}
          </span>

          {typeof donor.distance_km === 'number' && (
            <span className="text-muted">
              {t('search.away', { km: n(Math.round(donor.distance_km * 10) / 10) })}
            </span>
          )}

          {donor.total_donations > 0 && (
            <span className="text-muted">
              {t('search.donations', { count: donor.total_donations })}
            </span>
          )}
        </div>

        {lastDonation && (
          <p className="mt-1 text-sm text-muted">{t('search.lastGave', { month: lastDonation })}</p>
        )}
      </div>
    </li>
  )
}
