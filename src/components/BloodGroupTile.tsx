import { Link } from 'react-router-dom'
import { m } from '@/lib/motion'
import { groupToSlug, splitGroup, tileColorVar, type BloodGroup } from '@/lib/blood'
import { useI18n } from '@/lib/i18n'
import { useReducedMotion } from '@/lib/hooks'
import { cn } from '@/lib/cn'

export type TileDatum = {
  group: BloodGroup
  /** Donors in this group who are past their cooldown right now. */
  available: number
}

type Props = {
  datum: TileDatum
  /** The largest available count in the grid, used to scale the fill bar. */
  peak: number
  index: number
  /** False while loading, and while the database has nothing in it yet. */
  hasData: boolean
}

/**
 * Below this share of the strongest group, a group counts as scarce.
 * Tuned so the marker lands on the groups that are genuinely thin in the pool,
 * which in Bangladesh means the negatives. If most of the grid is hatched the
 * marker stops meaning anything.
 */
const SCARCITY_RATIO = 0.15

export function BloodGroupTile({ datum, peak, index, hasData }: Props) {
  const { t, n } = useI18n()
  const reduced = useReducedMotion()
  const { group, available } = datum
  const { letters, sign } = splitGroup(group)

  const share = hasData && peak > 0 ? available / peak : 0
  // With no numbers in yet, every tile would look scarce and the hatch would
  // read as a warning about nothing. Say nothing instead.
  const scarce = hasData && share < SCARCITY_RATIO

  const spokenGroup = `${letters} ${sign === '+' ? t('group.positive') : t('group.negative')}`
  const label = hasData
    ? `${spokenGroup}. ${t('home.grid.donorsAvailable', { count: available })}${
        scarce ? `. ${t('home.grid.scarce')}` : ''
      }`
    : spokenGroup

  return (
    <m.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={
        reduced
          ? { duration: 0.2 }
          : // Tiles settle in one after another, like signs being hung.
            { duration: 0.38, delay: 0.04 * index, ease: [0.2, 0.8, 0.2, 1] }
      }
    >
      <Link
        to={`/find?g=${groupToSlug(group)}`}
        aria-label={label}
        className={cn(
          'ink-press relative flex aspect-[5/6] flex-col overflow-hidden',
          // A 20px radius on a 66px tile turns the block into a blob. The
          // corner grows with the tile so the shape stays a painted sign.
          'rounded-[12px] border-2 border-line p-1.5 text-tile-ink shadow-ink-2',
          'sm:rounded-[16px] sm:p-2.5 lg:rounded-tile',
          'focus-visible:outline-offset-4',
        )}
        style={{ backgroundColor: tileColorVar(group) }}
      >
        {/* Scarcity is shown as a hatch AND in the accessible label, so it never
            depends on colour or on reading the number. */}
        {scarce && (
          <span aria-hidden="true" className="hatch pointer-events-none absolute inset-0" />
        )}

        {/* The sign gets its own high-contrast block, out of the letter's way.
            At 320px the difference between A+ and A- has to survive a glance in
            a hospital corridor. */}
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 rounded-sm bg-tile-ink px-1 py-px text-[10px] leading-none font-extrabold sm:top-2 sm:right-2 sm:px-1.5 sm:py-0.5 sm:text-sm"
          style={{ color: tileColorVar(group) }}
        >
          {sign === '+' ? '+' : '−'}
        </span>

        <span
          aria-hidden="true"
          className="relative flex flex-1 items-center justify-center text-[clamp(1.4rem,8vw,2.75rem)] leading-none font-extrabold tracking-tight"
        >
          {letters}
        </span>

        {/* Only shown once there are real numbers. An empty grid of zeroes
            reads as a dead project; a clean grid of eight groups does not. */}
        {hasData && (
          <span className="relative">
            <span
              aria-hidden="true"
              className="block text-center text-[11px] leading-tight font-bold tabular-nums sm:text-sm"
            >
              {n(available)}
            </span>
            {/* How this group compares with the strongest one. A living object:
                this bar moves as real people register and donate. */}
            <span
              aria-hidden="true"
              className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-tile-ink/20"
            >
              <m.span
                className="block h-full rounded-full bg-tile-ink"
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(4, share * 100)}%` }}
                transition={
                  reduced ? { duration: 0 } : { duration: 0.7, delay: 0.2 + 0.04 * index }
                }
              />
            </span>
          </span>
        )}
      </Link>
    </m.div>
  )
}
