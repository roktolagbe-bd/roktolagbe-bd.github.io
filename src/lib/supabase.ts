import type { SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Whether this build was given a real Supabase project.
 *
 * The site has to survive being deployed before the database exists, and it has
 * to survive someone cloning the repo with no .env at all. In both cases we
 * render sample data and say plainly that the site is not connected, rather
 * than throwing on import and showing a white screen.
 */
export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.includes('your-project-ref') && !anonKey.startsWith('your-'),
)

export const SUPABASE_URL = url ?? ''
export const SUPABASE_ANON_KEY = anonKey ?? ''

/**
 * The Supabase JS client is about 54kb gzipped. Nothing on first paint needs
 * it, so it is loaded on demand and cached. Landing page counters, search and
 * every form call this and await it; the entry chunk never contains it.
 *
 * The anon key being public is fine and intended. It identifies the anonymous
 * role, and the anonymous role can only do what Row Level Security allows:
 * INSERT into donors and blood_requests, and SELECT from the restricted public
 * views. It can never read a phone number. The security lives in Postgres, not
 * in this file.
 */
let clientPromise: Promise<SupabaseClient> | null = null

export function getSupabase(): Promise<SupabaseClient> | null {
  if (!isSupabaseConfigured) return null

  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Anonymous visitors never sign in. Only the admin panel does, and its
        // own bundle handles that session.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      global: { headers: { 'x-application-name': 'roktolagbe-web' } },
    }),
  )

  return clientPromise
}

/** Throws a readable error instead of a null dereference deep in a component. */
export async function requireSupabase(): Promise<SupabaseClient> {
  const promise = getSupabase()
  if (!promise) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
  }
  return promise
}
