import { BLOOD_GROUPS } from '@/lib/blood'
import { useI18n } from '@/lib/i18n'
import { BloodGroupTile, type TileDatum } from './BloodGroupTile'

type Props = {
  data: TileDatum[]
  loading?: boolean
}

/**
 * The one loud thing on this site.
 *
 * Eight tiles, four across, two rows, visible without scrolling on a 320px
 * phone. Tapping one is the whole product: it drops you into search with that
 * group already chosen. Everything else on the landing page is quieter than
 * this on purpose.
 *
 * The grid is alive. Each tile carries the number of donors in that group who
 * are past their cooldown right now, and a bar showing how that compares with
 * the strongest group, so a glance tells you whether you are in trouble.
 */
export function BloodGrid({ data, loading = false }: Props) {
  const { t } = useI18n()

  const byGroup = new Map(data.map((d) => [d.group, d]))
  const ordered: TileDatum[] = BLOOD_GROUPS.map(
    (group) => byGroup.get(group) ?? { group, available: 0 },
  )
  const peak = Math.max(...ordered.map((d) => d.available), 0)
  const hasData = !loading && peak > 0

  return (
    <nav aria-label={t('home.grid.label')}>
      {/* Four across on a phone so all eight are on screen without scrolling,
          eight across on a wide screen so the grid reads as a single object. */}
      <ul className="grid grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-8">
        {ordered.map((datum, index) => (
          <li key={datum.group}>
            <BloodGroupTile datum={datum} peak={peak} index={index} hasData={hasData} />
          </li>
        ))}
      </ul>
    </nav>
  )
}
