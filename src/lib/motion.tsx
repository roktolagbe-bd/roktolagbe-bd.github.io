import { LazyMotion, m } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * Motion, sized for a cheap Android phone on a slow connection.
 *
 * Importing `motion` directly pulls Framer Motion's entire feature set into the
 * entry chunk, about 42kb gzipped, before anything appears on screen. `m` plus
 * LazyMotion ships a few kilobytes up front and fetches the animation features
 * in the background. Elements render immediately either way; if the features
 * never arrive, the page is simply static, which is the correct failure.
 *
 * Import `m` from this file, never `motion` from framer-motion.
 */
const loadFeatures = () => import('./motion-features').then((mod) => mod.default)

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  )
}

export { m }
export { AnimatePresence } from 'framer-motion'
