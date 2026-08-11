import { useEffect, useRef } from 'react'
import { useReducedMotion } from '@/lib/hooks'

const COLOURS = [
  'var(--tile-a-pos)',
  'var(--tile-b-pos)',
  'var(--tile-ab-pos)',
  'var(--tile-o-pos)',
  'var(--c-jol-fill)',
]

/**
 * The one purely celebratory thing on this site.
 *
 * Someone just agreed to give blood to a stranger. That deserves a moment, and
 * it is also the moment they decide whether to share the site with anyone else.
 *
 * Flat rectangles in the tile colours, no library, no images. Renders nothing
 * at all under prefers-reduced-motion; the success message carries the news on
 * its own.
 */
export function Confetti({ pieces = 60 }: { pieces?: number }) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (reduced) return
    const host = ref.current
    if (!host) return

    const timers: number[] = []
    for (let i = 0; i < pieces; i++) {
      const piece = document.createElement('span')
      const size = 6 + Math.random() * 8
      piece.style.cssText = `
        position:absolute; top:-24px; left:${Math.random() * 100}%;
        width:${size}px; height:${size * (0.4 + Math.random())}px;
        background:${COLOURS[i % COLOURS.length]};
        border:1.5px solid var(--c-line);
        opacity:0;
      `
      host.appendChild(piece)

      const fall = piece.animate(
        [
          { transform: 'translate3d(0,0,0) rotate(0deg)', opacity: 1 },
          {
            transform: `translate3d(${(Math.random() - 0.5) * 160}px, ${
              260 + Math.random() * 220
            }px, 0) rotate(${(Math.random() - 0.5) * 900}deg)`,
            opacity: 0,
          },
        ],
        {
          duration: 1600 + Math.random() * 1400,
          delay: Math.random() * 350,
          easing: 'cubic-bezier(.2,.6,.4,1)',
          fill: 'forwards',
        },
      )
      fall.onfinish = () => piece.remove()
      timers.push(window.setTimeout(() => piece.remove(), 3600))
    }

    return () => {
      timers.forEach(clearTimeout)
      host.replaceChildren()
    }
  }, [pieces, reduced])

  if (reduced) return null

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-visible"
    />
  )
}
