import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Field, Input } from '@/components/form/Field'
import { Button, ButtonLink } from '@/components/Button'
import { useI18n, type TKey } from '@/lib/i18n'
import { getSupabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { useAdminSession } from './session'
import { Dashboard } from './Dashboard'
import { Donors } from './Donors'
import { Requests } from './Requests'
import { Settings } from './Settings'
import { Audit, MasterData, Queue } from './Operations'
import { Health } from './Health'

type Tab = 'dashboard' | 'health' | 'donors' | 'requests' | 'queue' | 'settings' | 'master' | 'audit'

const TABS: Array<{ id: Tab; key: TKey }> = [
  { id: 'dashboard', key: 'admin.nav.dashboard' },
  { id: 'health', key: 'admin.nav.health' },
  { id: 'donors', key: 'admin.nav.donors' },
  { id: 'requests', key: 'admin.nav.requests' },
  { id: 'queue', key: 'admin.nav.queue' },
  { id: 'settings', key: 'admin.nav.settings' },
  { id: 'master', key: 'admin.nav.master' },
  { id: 'audit', key: 'admin.nav.audit' },
]

/**
 * The admin panel.
 *
 * This whole module is a lazy chunk, Recharts included. Almost nobody who
 * visits this site is an admin, and the people who are can wait a second.
 *
 * Access needs two things: a Supabase session, and a row in the `admins`
 * allowlist. A valid session that is not on the list is refused here, and
 * would be refused again by Postgres even if this component were bypassed.
 */
export default function AdminApp() {
  const { t } = useI18n()
  const session = useAdminSession()
  const [tab, setTab] = useState<Tab>('dashboard')

  if (session.status === 'unconfigured') {
    return (
      <Shell title={t('page.admin.title')}>
        <p className="text-muted">{t('config.missing.title')}</p>
      </Shell>
    )
  }

  if (session.status === 'loading') {
    return (
      <Shell title={t('page.admin.title')}>
        <p role="status">{t('common.loading')}</p>
      </Shell>
    )
  }

  if (session.status === 'signed_out') return <SignIn />

  if (session.status === 'not_allowed') {
    return (
      <Shell title={t('admin.denied.title')}>
        <p className="max-w-prose text-muted">{t('admin.denied.body')}</p>
        <p className="mt-2 text-sm text-muted">{session.email}</p>
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" onClick={() => void session.signOut()}>
            {t('admin.signOut')}
          </Button>
          <ButtonLink to="/" variant="ghost">
            {t('notfound.action')}
          </ButtonLink>
        </div>
      </Shell>
    )
  }

  const client = session.client

  return (
    <Shell
      title={t('page.admin.title')}
      action={
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">{session.email}</span>
          <Button variant="secondary" size="sm" onClick={() => void session.signOut()}>
            {t('admin.signOut')}
          </Button>
        </div>
      }
    >
      <nav aria-label={t('page.admin.title')} className="mb-5 overflow-x-auto">
        <ul className="flex gap-1">
          {TABS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
                className={cn(
                  'min-h-11 rounded-md border-2 border-line px-3 text-sm font-bold whitespace-nowrap',
                  tab === item.id ? 'bg-ink text-surface' : 'bg-raise text-ink hover:bg-sunk',
                )}
              >
                {t(item.key)}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'dashboard' && <Dashboard client={client} />}
      {tab === 'health' && <Health client={client} />}
      {tab === 'donors' && <Donors client={client} />}
      {tab === 'requests' && <Requests client={client} />}
      {tab === 'queue' && <Queue client={client} />}
      {tab === 'settings' && <Settings client={client} />}
      {tab === 'master' && <MasterData client={client} />}
      {tab === 'audit' && <Audit client={client} />}
    </Shell>
  )
}

function Shell({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-hero font-extrabold">{title}</h1>
        {action}
      </div>
      {children}
    </section>
  )
}

function SignIn() {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<TKey | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const pending = getSupabase()
    if (!pending) {
      setBusy(false)
      setError('config.missing.title')
      return
    }

    const client: SupabaseClient = await pending
    const { error: authError } = await client.auth.signInWithPassword({ email, password })
    setBusy(false)

    // Deliberately one message for both a wrong password and an unknown
    // address. Telling them apart would confirm which emails have accounts.
    if (authError) setError('admin.signIn.failed')
    // On success, useAdminSession picks up the change and re-renders.
  }

  return (
    <Shell title={t('admin.signIn.title')}>
      <form onSubmit={submit} className="grid max-w-sm gap-4">
        <Field label={t('form.email')} required>
          {({ id }) => (
            <Input
              id={id}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
        </Field>

        <Field label={t('admin.password')} required>
          {({ id }) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>

        {error && (
          <p role="alert" className="rounded-md border-2 border-line bg-shindur-fill px-3 py-2 text-sm font-bold text-tile-ink">
            {t(error)}
          </p>
        )}

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? t('register.submitting') : t('admin.signIn.action')}
        </Button>

        <p className="text-sm text-muted">{t('admin.signIn.note')}</p>
      </form>
    </Shell>
  )
}
