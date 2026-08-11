import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useI18n, type TKey } from '@/lib/i18n'
import { cn } from '@/lib/cn'
import { Brand } from './Brand'
import { LangToggle } from './LangToggle'
import { ThemeToggle } from './ThemeToggle'

const LINKS: Array<{ to: string; key: TKey }> = [
  { to: '/find', key: 'nav.find' },
  { to: '/request', key: 'nav.request' },
  { to: '/register', key: 'nav.register' },
  { to: '/eligibility', key: 'nav.eligibility' },
  { to: '/donors', key: 'nav.wall' },
  { to: '/learn', key: 'nav.learn' },
]

export function Header() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const location = useLocation()

  // Close the menu on navigation, otherwise it hangs over the new page.
  useEffect(() => setOpen(false), [location.pathname])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-md px-2.5 py-2 text-sm font-bold no-underline transition-colors',
      isActive ? 'bg-ink text-surface' : 'text-ink hover:bg-sunk',
    )

  return (
    <header className="sticky top-0 z-40 border-b-2 border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <Brand />

        <nav aria-label={t('nav.menu')} className="ml-auto hidden lg:block">
          <ul className="flex items-center gap-0.5">
            {LINKS.map((link) => (
              <li key={link.to}>
                <NavLink to={link.to} className={linkClass}>
                  {t(link.key)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <LangToggle />
          <ThemeToggle />

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? t('nav.close') : t('nav.menu')}
            className="ink-press inline-flex size-9 items-center justify-center rounded-md border-2 border-line bg-raise shadow-ink-1 lg:hidden"
          >
            <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true" fill="currentColor">
              {open ? (
                <path d="M3.4 2 18 16.6 16.6 18 2 3.4z M16.6 2 18 3.4 3.4 18 2 16.6z" />
              ) : (
                <path d="M2 3.5h16v2.6H2zM2 8.7h16v2.6H2zM2 13.9h16v2.6H2z" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          aria-label={t('nav.menu')}
          className="border-t-2 border-line bg-raise lg:hidden"
        >
          <ul className="mx-auto max-w-6xl px-4 py-2">
            {LINKS.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-md px-3 py-3 text-base font-bold no-underline',
                      isActive ? 'bg-ink text-surface' : 'text-ink hover:bg-sunk',
                    )
                  }
                >
                  {t(link.key)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  )
}
