type ClassValue = string | number | false | null | undefined | ClassValue[]

/** Joins class names. Deliberately not a dependency; this is all we need. */
export function cn(...values: ClassValue[]): string {
  const out: string[] = []
  for (const value of values) {
    if (!value) continue
    if (Array.isArray(value)) {
      const nested = cn(...value)
      if (nested) out.push(nested)
    } else {
      out.push(String(value))
    }
  }
  return out.join(' ')
}
