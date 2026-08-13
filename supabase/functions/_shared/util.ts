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

/**
 * A Postgres error, in a shape that is safe to send back to the caller.
 *
 * `{"error":"internal_error"}` cost two days of debugging on the one path that
 * needed debugging. The real cause — 42P10, no usable ON CONFLICT arbiter —
 * was sitting in the function logs the whole time, visible only to somebody
 * who knew to look in the Supabase dashboard.
 *
 * So the code, the message and the hint come back. They describe the SCHEMA,
 * and this schema is open source; there is nothing in them an attacker cannot
 * read in the repository.
 *
 * `details` is deliberately dropped. That is the one field Postgres fills with
 * row VALUES — "Key (phone)=(8801...) already exists" — and a donor's phone
 * number must not leave the database in an error string any more than it may
 * in a response body.
 */
export function errorPayload(err: unknown, stage: string): Record<string, unknown> {
  const e = err as { code?: string; message?: string; hint?: string } | null

  return {
    error: 'internal_error',
    // Where in the pipeline it broke, so the next report starts further along.
    stage,
    code: e?.code ?? null,
    message: e?.message ?? (err instanceof Error ? err.message : String(err)),
    hint: e?.hint ?? null,
  }
}

/**
 * A display name that is safe to put in a mail header.
 *
 * The From header was built as `${senderName} <${address}>` with senderName
 * defaulting to রক্ত লাগবে, and those raw UTF-8 bytes went straight into the
 * header block. A mail header is defined as US-ASCII (RFC 5322); anything else
 * has to be an RFC 2047 encoded-word. Gmail responded by treating the header
 * block as finished at that point, so From, To, Date, MIME-Version and
 * Content-Type all appeared as body text, and the Subject — which the mailer
 * HAD encoded correctly — was shown as literal =?utf-8?Q?... because by then
 * it was no longer in a header position.
 *
 * Base64 rather than quoted-printable: in Bangla nearly every byte needs
 * escaping, so Q-encoding runs about three times longer and hits the 75
 * character limit constantly.
 *
 * Pure ASCII passes through untouched, so an English sender name produces
 * exactly the header it did before.
 */
export function encodeHeaderWord(text: string): string {
  // CR and LF in a header value are how header injection works, and a stray
  // one is also a second way to end the header block early. Never pass them on.
  const clean = text.replace(/[\r\n]+/g, ' ').trim()
  if (!clean) return ''

  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(clean)) return clean

  // RFC 2047: an encoded-word must be at most 75 characters INCLUDING the
  // =?utf-8?B?...?= wrapper, and a multi-byte character may never be split
  // across two of them. So chunk by encoded length, testing whole characters.
  const PREFIX = '=?utf-8?B?'
  const SUFFIX = '?='
  const budget = 75 - PREFIX.length - SUFFIX.length

  const encoder = new TextEncoder()
  const words: string[] = []
  let chunk = ''

  for (const char of clean) {
    const candidate = chunk + char
    // 4 base64 characters per 3 bytes, rounded up.
    const encodedLength = Math.ceil(encoder.encode(candidate).length / 3) * 4
    if (encodedLength > budget && chunk) {
      words.push(PREFIX + base64(chunk) + SUFFIX)
      chunk = char
    } else {
      chunk = candidate
    }
  }
  if (chunk) words.push(PREFIX + base64(chunk) + SUFFIX)

  // Encoded-words are joined by whitespace, which a decoder removes between
  // two of them.
  return words.join(' ')
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * The complete From value: an encoded display name and a bare address.
 *
 * The address itself is never encoded — an addr-spec must stay ASCII, and if
 * it is not, no encoding will save it.
 */
export function fromHeader(displayName: string, address: string): string {
  const name = encodeHeaderWord(displayName)
  const clean = address.replace(/[\r\n<>]/g, '').trim()
  return name ? `${name} <${clean}>` : clean
}
