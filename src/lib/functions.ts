import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './supabase'

/**
 * Calls a Supabase Edge Function.
 *
 * Plain fetch rather than the SDK's functions client, because that would pull
 * the whole Supabase bundle onto pages that need nothing else from it. The
 * anon key is enough: these functions authorise on the token in the body, not
 * on the caller.
 *
 * This used to discard everything it learned. A non-200 returned
 * `{ reason: 'error', status }` and dropped the body, so the Edge Function
 * could explain exactly what went wrong and the browser would throw the
 * explanation away. A thrown fetch returned `{ reason: 'network' }` from a
 * bare `catch {}`, so a request that never left the browser looked identical
 * to one the server refused.
 *
 * Both are now kept and logged. The console is the only place a volunteer
 * debugging this from a phone in Dhaka can look.
 */

export type FunctionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      reason: 'not_configured' | 'network' | 'error'
      status?: number
      /** The server's own words, when there were any. */
      detail?: string
    }

/**
 * Trailing slashes are the classic way this breaks.
 *
 * `https://ref.supabase.co/` plus `/functions/v1/x` is
 * `https://ref.supabase.co//functions/v1/x`, which does not route, and the
 * browser reports it as an ordinary network failure with no invocation ever
 * recorded against the function. Somebody pasting the project URL with the
 * slash Supabase's dashboard shows would hit exactly that.
 */
const BASE = SUPABASE_URL.replace(/\/+$/, '')

export async function callFunction<T>(
  name: string,
  body: unknown,
  timeoutMs = 15_000,
): Promise<FunctionResult<T>> {
  if (!isSupabaseConfigured) return { ok: false, reason: 'not_configured' }

  const url = `${BASE}/functions/v1/${name}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      // Read it before deciding it is useless. Since the functions started
      // returning errorPayload(), this carries the Postgres code and message.
      const detail = await response.text().catch(() => '')
      console.error(
        `Edge Function ${name} returned ${response.status}.`,
        detail || '(empty body)',
      )
      return { ok: false, reason: 'error', status: response.status, detail }
    }

    return { ok: true, data: (await response.json()) as T }
  } catch (err) {
    // A throw here means the request did not complete: DNS, CORS, offline, a
    // bad URL, or our own timeout. None of those reach the function, so none
    // of them appear in the Supabase logs — this console line is the only
    // record that the call was even attempted.
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    console.error(
      `Edge Function ${name} was never reached (${aborted ? `timed out after ${timeoutMs}ms` : 'network or CORS'}).`,
      `URL: ${url}`,
      err,
    )
    return {
      ok: false,
      reason: 'network',
      detail: aborted ? `timeout after ${timeoutMs}ms` : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}
