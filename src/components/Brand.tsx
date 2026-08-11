import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'

/**
 * The wordmark stays Bangla in both languages. রক্ত লাগবে is the phrase people
 * actually type into Facebook at 2am, and that phrase is the product. An
 * English visitor can read the tagline; they do not need the name translated.
 *
 * The mark itself is the first blood group tile: a painted block with an ink
 * outline, holding the word for blood.
 */
export function Brand({ className, asLink = true }: { className?: string; asLink?: boolean }) {
  const content = (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 text-lg font-extrabold tracking-tight sm:text-xl',
        className,
      )}
      lang="bn"
    >
      <span className="rounded-sm border-2 border-line bg-shindur-fill px-1.5 text-tile-ink">
        রক্ত
      </span>
      <span>লাগবে</span>
    </span>
  )

  if (!asLink) return content

  return (
    <Link to="/" className="rounded-md no-underline" aria-label="রক্ত লাগবে, Roktolagbe">
      {content}
    </Link>
  )
}
