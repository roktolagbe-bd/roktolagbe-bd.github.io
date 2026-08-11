import { Link } from 'react-router-dom'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'urgent' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  // Indigo, not red. Red is reserved for blood and danger.
  // The foreground is a token, not `text-white`: the accents invert in dark
  // mode, so a fixed white would fall to 2.2:1 there.
  primary: 'bg-nil text-on-nil border-line',
  secondary: 'bg-raise text-ink border-line',
  urgent: 'bg-shindur text-on-shindur border-line',
  ghost: 'bg-transparent text-ink border-transparent shadow-none',
}

const SIZES: Record<Size, string> = {
  // 44px minimum touch target on every size, including sm.
  sm: 'min-h-11 px-3 text-sm',
  md: 'min-h-12 px-5 text-base',
  lg: 'min-h-14 px-7 text-lg',
}

function classes(variant: Variant, size: Size, block: boolean, className?: string) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md border-2 font-bold',
    'ink-press select-none no-underline',
    variant !== 'ghost' && 'shadow-ink-2',
    variant === 'ghost' && 'hover:bg-sunk',
    'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
    VARIANTS[variant],
    SIZES[size],
    block && 'w-full',
    className,
  )
}

type CommonProps = {
  variant?: Variant
  size?: Size
  block?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  type = 'button',
  children,
  ...rest
}: CommonProps & ComponentProps<'button'>) {
  return (
    <button type={type} className={classes(variant, size, block, className)} {...rest}>
      {children}
    </button>
  )
}

/** Same shape as Button, but a real link, so middle-click and copy work. */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  children,
  ...rest
}: CommonProps & ComponentProps<typeof Link>) {
  return (
    <Link className={classes(variant, size, block, className)} {...rest}>
      {children}
    </Link>
  )
}
