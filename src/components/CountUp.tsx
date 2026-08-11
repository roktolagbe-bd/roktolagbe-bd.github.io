import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { useInView, useReducedMotion } from '@/lib/hooks'

type Props = {
  value: number
  /** Milliseconds for the whole count. */
  duration?: number
  className?: string
}

/**
 * Counts up to a real number when it scrolls into view.
 *
 * The count is not decoration. These are people who signed up and requests that
 * were filled, and watching the number climb is the closest this site gets to
 * saying "this works". It renders the final value immediately for anyone who
 * has asked for reduced motion, and it renders Bangla digits in Bangla.
 */
export function CountUp({ value, duration = 1100, className }: Props) {
  const { n } = useI18n()
  const reduced = useReducedMotion()
  const { ref, inView } = useInView<HTMLSpanElement>()
  const [shown, setShown] = useState(reduced ? value : 0)
  const frame = useRef<number>(0)

  useEffect(() => {
    if (reduced || !inView) {
      setShown(value)
      return
    }

    const start = performance.now()
    const from = 0

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      // Ease out cubic: fast at first, settles gently, like the tiles do.
      const eased = 1 - Math.pow(1 - progress, 3)
      setShown(Math.round(from + (value - from) * eased))
      if (progress < 1) frame.current = requestAnimationFrame(step)
    }

    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [value, duration, inView, reduced])

  return (
    <span
      ref={ref}
      className={className}
      // Screen readers should hear the real number once, not every frame of it.
      aria-label={n(value)}
    >
      <span aria-hidden="true">{n(shown)}</span>
    </span>
  )
}
