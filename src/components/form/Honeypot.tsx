import { useEffect, useRef, useState } from 'react'

export const HONEYPOT_NAME = 'company_website'

/**
 * A field no human ever sees and no human ever fills.
 *
 * Bots parse the HTML and complete every input they find. People do not,
 * because this one is off screen and removed from the accessibility tree.
 *
 * Deliberately not `display: none` or `hidden`: some bots skip those. Moving
 * it off screen keeps it in the DOM and fillable, which is the point of a
 * trap. `tabIndex={-1}` and `aria-hidden` keep keyboard and screen reader
 * users from ever reaching it.
 *
 * This is not real security. It is a free way to drop the crude majority of
 * automated signups without making a genuine donor solve a puzzle from a
 * company that would then learn who visits this site.
 */
export function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label htmlFor={HONEYPOT_NAME}>Leave this field empty</label>
      <input
        id={HONEYPOT_NAME}
        name={HONEYPOT_NAME}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/**
 * How long this form has been on screen.
 *
 * A registration completed in under a few seconds was not typed by a person.
 * Paired with the honeypot this stops most scripted submissions, and neither
 * costs a real user anything.
 */
export function useFormTiming(minimumSeconds = 4) {
  const startedAt = useRef(Date.now())
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    // Re-render once the threshold passes so a form that was filled slowly is
    // never blocked by a stale reading.
    const remaining = minimumSeconds * 1000 - (Date.now() - startedAt.current)
    if (remaining <= 0) return
    const timer = setTimeout(() => forceUpdate((n) => n + 1), remaining + 50)
    return () => clearTimeout(timer)
  }, [minimumSeconds])

  const elapsedSeconds = () => (Date.now() - startedAt.current) / 1000
  return {
    elapsedSeconds,
    tooFast: () => elapsedSeconds() < minimumSeconds,
  }
}
