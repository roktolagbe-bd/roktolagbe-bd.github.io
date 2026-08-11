/** The eight groups, in the order they appear in the grid. */
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const

export type BloodGroup = (typeof BLOOD_GROUPS)[number]

/* '+' has to be percent-encoded in a URL, which makes tokenised links in emails
   look broken and makes people distrust them. Slugs keep every URL clean. */
const SLUGS: Record<BloodGroup, string> = {
  'A+': 'a-pos',
  'A-': 'a-neg',
  'B+': 'b-pos',
  'B-': 'b-neg',
  'AB+': 'ab-pos',
  'AB-': 'ab-neg',
  'O+': 'o-pos',
  'O-': 'o-neg',
}

const BY_SLUG: Record<string, BloodGroup> = Object.fromEntries(
  Object.entries(SLUGS).map(([group, slug]) => [slug, group as BloodGroup]),
)

export function groupToSlug(group: BloodGroup): string {
  return SLUGS[group]
}

export function slugToGroup(slug: string | null | undefined): BloodGroup | null {
  if (!slug) return null
  return BY_SLUG[slug.toLowerCase()] ?? null
}

export function isBloodGroup(value: unknown): value is BloodGroup {
  return typeof value === 'string' && (BLOOD_GROUPS as readonly string[]).includes(value)
}

/** Splits 'AB+' into its parts so the tile can set the sign as its own block. */
export function splitGroup(group: BloodGroup): { letters: string; sign: '+' | '-' } {
  const sign = group.endsWith('+') ? '+' : '-'
  return { letters: group.slice(0, -1), sign }
}

/** The CSS custom property holding this group's tile fill. */
export function tileColorVar(group: BloodGroup): string {
  const { letters, sign } = splitGroup(group)
  return `var(--tile-${letters.toLowerCase()}-${sign === '+' ? 'pos' : 'neg'})`
}

/**
 * Who this group can give to, and who it can receive from.
 * Used on the learn page and to explain why O- matters so much.
 */
export const COMPATIBILITY: Record<BloodGroup, { givesTo: BloodGroup[]; receivesFrom: BloodGroup[] }> =
  {
    'O-': { givesTo: [...BLOOD_GROUPS], receivesFrom: ['O-'] },
    'O+': { givesTo: ['O+', 'A+', 'B+', 'AB+'], receivesFrom: ['O-', 'O+'] },
    'A-': { givesTo: ['A-', 'A+', 'AB-', 'AB+'], receivesFrom: ['O-', 'A-'] },
    'A+': { givesTo: ['A+', 'AB+'], receivesFrom: ['O-', 'O+', 'A-', 'A+'] },
    'B-': { givesTo: ['B-', 'B+', 'AB-', 'AB+'], receivesFrom: ['O-', 'B-'] },
    'B+': { givesTo: ['B+', 'AB+'], receivesFrom: ['O-', 'O+', 'B-', 'B+'] },
    'AB-': { givesTo: ['AB-', 'AB+'], receivesFrom: ['O-', 'A-', 'B-', 'AB-'] },
    'AB+': { givesTo: ['AB+'], receivesFrom: [...BLOOD_GROUPS] },
  }
