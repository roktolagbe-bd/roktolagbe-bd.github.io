import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Shared bits for every Edge Function.
 *
 * These run as service_role, which bypasses every Row Level Security policy in
 * migration 0009. That is the whole reason they exist: they are the only place
 * allowed to read a donor's phone number. Nothing here should ever return one
 * to a caller.
 */

export const CORS = {
  // The site is the only browser origin that calls these, but Pages serves
  // from one host and previews from another, so the check is on the token
  // rather than the origin.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: CORS }) : null
}

/** The service_role client. Never hand this to anything that returns to a browser. */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * The caller's IP address, as seen by the edge.
 *
 * This is passed straight to hash_ip() in Postgres and never stored raw. The
 * first entry in x-forwarded-for is the client; the rest are proxies.
 */
export function callerIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? null
}

export async function readSettings(supabase: SupabaseClient): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('admin_settings').select('key, value')
  if (error) throw error
  const out: Record<string, unknown> = {}
  for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
    out[row.key] = row.value
  }
  return out
}

export function settingInt(settings: Record<string, unknown>, key: string, fallback: number) {
  const value = settings[key]
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function settingBool(settings: Record<string, unknown>, key: string, fallback: boolean) {
  const value = settings[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 'true'
  return fallback
}

export function settingString(settings: Record<string, unknown>, key: string, fallback: string) {
  const value = settings[key]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}
