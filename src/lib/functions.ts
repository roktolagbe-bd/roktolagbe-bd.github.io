import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './supabase'

/**
 * Calls a Supabase Edge Function.
 *
 * Plain fetch rather than the SDK's functions client, because that would pull
 * the whole Supabase bundle onto pages that need nothing else from it. The
 * anon key is enough: these functions authorise on the token in the body, not
 * on the caller.
 */
export async function callFunction<T>(
  name: string,
  body: unknown,
  timeoutMs = 15_000,
): Promise<{ ok: true; data: T } | { ok: false; reason: 'not_configured' | 'network' | 'error'; status?: number }> {
  if (!isSupabaseConfigured) return { ok: false, reason: 'not_configured' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) return { ok: false, reason: 'error', status: response.status }
    return { ok: true, data: (await response.json()) as T }
  } catch {
    return { ok: false, reason: 'network' }
  } finally {
    clearTimeout(timer)
  }
}
