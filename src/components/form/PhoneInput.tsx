import { useMemo } from 'react'
import { cn } from '@/lib/cn'

/**
 * A phone field with the country code split out.
 *
 * Bangladesh is the default and the flag is there so it is recognisable at a
 * glance rather than needing to be read. The other entries are the places
 * Bangladeshis most often live and work: a donor visiting home for a month is
 * still a donor, and a relative abroad is very often the one making the
 * request on someone's behalf.
 *
 * The value handed back is always plain digits in international form, so
 * 01712345678 typed with the Bangladesh code selected comes out as
 * 8801712345678, which is exactly what a wa.me link needs.
 */

export type Country = {
  iso: string
  dial: string
  flag: string
  name: string
  /** What to show in the empty box, in the shape people actually write. */
  placeholder: string
  /** Digits after the country code. Bangladesh mobiles are always 10 after 88. */
  nationalLength: number[]
}

export const COUNTRIES: Country[] = [
  { iso: 'BD', dial: '880', flag: '🇧🇩', name: 'Bangladesh', placeholder: '1712 345678', nationalLength: [10] },
  { iso: 'IN', dial: '91', flag: '🇮🇳', name: 'India', placeholder: '98765 43210', nationalLength: [10] },
  { iso: 'SA', dial: '966', flag: '🇸🇦', name: 'Saudi Arabia', placeholder: '51 234 5678', nationalLength: [9] },
  { iso: 'AE', dial: '971', flag: '🇦🇪', name: 'United Arab Emirates', placeholder: '50 123 4567', nationalLength: [9] },
  { iso: 'MY', dial: '60', flag: '🇲🇾', name: 'Malaysia', placeholder: '12 345 6789', nationalLength: [9, 10] },
  { iso: 'SG', dial: '65', flag: '🇸🇬', name: 'Singapore', placeholder: '8123 4567', nationalLength: [8] },
  { iso: 'GB', dial: '44', flag: '🇬🇧', name: 'United Kingdom', placeholder: '7400 123456', nationalLength: [10] },
  { iso: 'US', dial: '1', flag: '🇺🇸', name: 'United States', placeholder: '201 555 0123', nationalLength: [10] },
  { iso: 'IT', dial: '39', flag: '🇮🇹', name: 'Italy', placeholder: '312 345 6789', nationalLength: [9, 10] },
  { iso: 'QA', dial: '974', flag: '🇶🇦', name: 'Qatar', placeholder: '3312 3456', nationalLength: [8] },
]

export const DEFAULT_COUNTRY = COUNTRIES[0] as Country

/** Longest dial codes first, so 880 wins over 88 and 971 over 97. */
const BY_LENGTH = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)

/**
 * Splits a stored value back into a country and a national number.
 *
 * Bangladesh needs care: a stored 8801712345678 starts with 880, but so does a
 * locally typed 01712345678 once you strip the leading zero. Matching on the
 * dial code alone would read "01712345678" as country 1 (United States), so a
 * bare local number is treated as Bangladesh, which is what it almost always is.
 */
export function splitPhone(value: string): { country: Country; national: string } {
  const digits = value.replace(/\D/g, '')
  if (!digits) return { country: DEFAULT_COUNTRY, national: '' }

  // A local Bangladeshi number as people write it: 01XXXXXXXXX.
  if (digits.startsWith('0')) {
    return { country: DEFAULT_COUNTRY, national: digits.replace(/^0+/, '') }
  }

  for (const country of BY_LENGTH) {
    if (digits.startsWith(country.dial)) {
      const rest = digits.slice(country.dial.length)
      if (country.nationalLength.includes(rest.replace(/^0+/, '').length) || rest.length > 0) {
        return { country, national: rest.replace(/^0+/, '') }
      }
    }
  }

  return { country: DEFAULT_COUNTRY, national: digits }
}

export function joinPhone(country: Country, national: string): string {
  // A leading zero is how the number is written at home and is not part of the
  // international form. Dropping it here means 01712345678 and 1712345678 both
  // arrive as 8801712345678.
  const digits = national.replace(/\D/g, '').replace(/^0+/, '')
  return digits ? `${country.dial}${digits}` : ''
}

type Props = {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string | undefined
  autoComplete?: string
  countryLabel: string
}

export function PhoneInput({
  id,
  value,
  onChange,
  invalid = false,
  describedBy,
  autoComplete = 'tel',
  countryLabel,
}: Props) {
  const { country, national } = useMemo(() => splitPhone(value), [value])

  return (
    <div
      className={cn(
        'flex overflow-hidden rounded-md border-2 bg-raise shadow-ink-1',
        invalid ? 'border-shindur' : 'border-line',
        // The ring goes on the group so focusing either half looks like one
        // control, which is what it is.
        'has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--c-focus)]',
      )}
    >
      <select
        aria-label={countryLabel}
        value={country.iso}
        onChange={(e) => {
          const next = COUNTRIES.find((c) => c.iso === e.target.value) ?? DEFAULT_COUNTRY
          onChange(joinPhone(next, national))
        }}
        className="min-h-12 max-w-32 shrink-0 border-r-2 border-line bg-sunk pr-1 pl-2.5 text-base font-bold outline-none"
      >
        {COUNTRIES.map((c) => (
          // The flag and the code together: the flag is recognised faster, the
          // code is what confirms it.
          <option key={c.iso} value={c.iso}>
            {c.flag} +{c.dial}
          </option>
        ))}
      </select>

      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        value={national}
        placeholder={country.placeholder}
        onChange={(e) => onChange(joinPhone(country, e.target.value))}
        className="min-h-12 w-full bg-raise px-3 text-ink outline-none placeholder:text-muted/70"
      />
    </div>
  )
}
