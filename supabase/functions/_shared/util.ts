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
 * Never leaves this module. hashedCallerIp() below is what the rest of the
 * code uses; this stays unexported so there is no convenient way to pass a
 * raw address anywhere else.
 *
 * The first entry in x-forwarded-for is the client; the rest are proxies.
 */
function callerIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? null
}

/**
 * A salt short enough to be guessed is not a salt.
 *
 * IPv4 is only 2^32 addresses, and a single core gets through the whole space
 * in about an hour. The salt is the only thing standing between a leaked
 * ip_hash column and a list of real addresses, so it has to be long enough
 * that it cannot be brute-forced alongside them.
 */
const MIN_SALT_LENGTH = 16

/**
 * The caller's address, salted and hashed, ready for check_and_record_ip.
 *
 * The salt lives in the IP_SALT Edge Function secret. It used to live in a
 * database setting, which cannot work on hosted Supabase: the `postgres` role
 * is not the database owner there, so `alter database postgres set` fails with
 * "permission denied to set parameter" on every plan.
 *
 * Hashing here rather than in Postgres means the raw address never reaches the
 * database at all, so no trigger, log line or query can put one in a table.
 *
 * Returns null when there is nothing safe to return: no address, or no usable
 * salt. The caller treats null as "cannot rate limit this one" and carries on,
 * because refusing to take a blood request over a missing environment variable
 * would be the wrong way round. It is loud in the logs instead.
 */
export async function hashedCallerIp(req: Request): Promise<string | null> {
  const ip = callerIp(req)
  if (!ip) return null

  const salt = Deno.env.get('IP_SALT')?.trim()
  if (!salt) {
    console.error(
      'IP_SALT is not set. Rate limiting by IP is DISABLED; the honeypot and ' +
        'time-on-page checks are still active. Set it under Project Settings ' +
        '-> Edge Functions -> Secrets. See README section 3f.',
    )
    return null
  }
  if (salt.length < MIN_SALT_LENGTH) {
    console.error(
      `IP_SALT is only ${salt.length} characters. A salt that short can be ` +
        `brute-forced along with the address, so it is being ignored. Use at ` +
        `least ${MIN_SALT_LENGTH}; 32 or more is better.`,
    )
    return null
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}|${ip.trim()}`),
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
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

/**
 * The gate on the drain endpoint.
 *
 * drain-email-queue is the one function nobody's browser should ever call: it
 * opens an SMTP connection and sends real mail. Something outside Supabase has
 * to trigger it on a schedule, and that something needs a credential.
 *
 * The obvious credential is the service_role key, and it is the wrong one. A
 * GitHub Actions secret is readable by every workflow in the repository and by
 * anyone who can push one, and service_role bypasses every RLS policy in the
 * database. That trades the whole donor table for a cron job.
 *
 * So the scheduler gets a secret that does one thing: prove it may ask for a
 * drain. It grants no database access, it is not a key to anything else, and
 * rotating it is changing one string in two places. If it leaks, the worst
 * anyone can do is cause the queue to be drained, which is what it is for.
 *
 * Fails closed. No DRAIN_SECRET configured means no caller is authorised,
 * rather than every caller being authorised.
 */
export async function drainSecretCheck(req: Request): Promise<Response | null> {
  const expected = Deno.env.get('DRAIN_SECRET')?.trim()

  if (!expected) {
    // Setup is incomplete rather than under attack. Say so distinctly, so the
    // caller can tell "finish the setup" from "your secret is wrong".
    return json(
      {
        error: 'not_configured',
        note: 'DRAIN_SECRET is not set in Supabase Edge Function secrets. See README section 3d.',
      },
      500,
    )
  }

  const presented = req.headers.get('x-drain-secret')?.trim()
  if (!presented || !(await constantTimeEquals(presented, expected))) {
    // Deliberately terse. An unauthorised caller learns nothing about why.
    return json({ error: 'unauthorized' }, 401)
  }

  return null
}

/**
 * Comparison whose duration does not depend on where two strings differ.
 *
 * Hashing first means the loop always runs over 32 bytes whatever the inputs
 * were, so length is not leaked either. A 256-bit random secret is not
 * realistically attackable by timing over the internet, but this is four lines
 * and removes the question.
 */
async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  const x = new Uint8Array(left)
  const y = new Uint8Array(right)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}
