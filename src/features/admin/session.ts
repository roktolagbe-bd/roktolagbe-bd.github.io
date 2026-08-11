import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'

export type AdminState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  /** Signed in, but not on the allowlist. This is a refusal, not an error. */
  | { status: 'not_allowed'; email: string | null }
  | { status: 'ready'; email: string | null; client: SupabaseClient }
  | { status: 'unconfigured' }

/**
 * Who is allowed into the admin panel.
 *
 * A valid Supabase session is not enough. Anyone can sign themselves up for a
 * Supabase project if signups are open, so membership of the `admins` table is
 * the actual gate, and it is checked by asking the database, not by reading a
 * claim out of the token.
 *
 * The check is also enforced in Postgres: every admin function calls
 * is_admin() itself, and every admin-only table has an RLS policy requiring
 * it. This hook decides what to render. It is not what protects the data.
 */
export function useAdminSession(): AdminState & { signOut: () => Promise<void> } {
  const [state, setState] = useState<AdminState>({ status: 'loading' })

  const evaluate = useCallback(async (client: SupabaseClient, session: Session | null) => {
    if (!session) {
      setState({ status: 'signed_out' })
      return
    }
    try {
      // is_admin() is SECURITY DEFINER and returns a plain boolean, so this
      // works even though the caller cannot read the admins table.
      const { data, error } = await client.rpc('is_admin')
      if (error) throw error
      if (data === true) {
        setState({ status: 'ready', email: session.user.email ?? null, client })
      } else {
        setState({ status: 'not_allowed', email: session.user.email ?? null })
      }
    } catch {
      setState({ status: 'not_allowed', email: session.user.email ?? null })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void (async () => {
      const pending = getSupabase()
      if (!pending) {
        if (!cancelled) setState({ status: 'unconfigured' })
        return
      }
      const client = await pending
      if (cancelled) return

      const { data } = await client.auth.getSession()
      await evaluate(client, data.session)

      const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
        void evaluate(client, session)
      })
      unsubscribe = () => sub.subscription.unsubscribe()
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [evaluate])

  const signOut = useCallback(async () => {
    const pending = getSupabase()
    if (!pending) return
    const client = await pending
    await client.auth.signOut()
    setState({ status: 'signed_out' })
  }, [])

  return { ...state, signOut }
}
