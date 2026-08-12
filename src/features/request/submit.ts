import { getSupabase } from '@/lib/supabase'
import { callFunction } from '@/lib/functions'
import { newId } from '@/lib/id'
import type { BloodGroup } from '@/lib/blood'
import type { Coords } from '@/lib/geolocation'

export type Urgency = 'critical' | 'urgent' | 'scheduled'

export type RequestForm = {
  requesterName: string
  requesterPhone: string
  requesterWhatsapp: string
  requesterEmail: string

  bloodGroup: BloodGroup | ''
  unitsNeeded: string
  urgency: Urgency

  hospitalId: string | null
  hospitalFreeText: string
  districtId: number | null
  upazilaId: number | null
  coords: Coords | null

  neededBy: string
  patientNote: string
}

export const emptyRequestForm: RequestForm = {
  requesterName: '',
  requesterPhone: '',
  requesterWhatsapp: '',
  requesterEmail: '',
  bloodGroup: '',
  unitsNeeded: '1',
  urgency: 'urgent',
  hospitalId: null,
  hospitalFreeText: '',
  districtId: null,
  upazilaId: null,
  coords: null,
  neededBy: '',
  patientNote: '',
}

export type MatchOutcome = {
  matched_count: number
  radius_km: number | null
  widened: boolean
  emails_queued: boolean
}

export type RequestResult =
  | { ok: true; requestId: string; match: MatchOutcome | null }
  | {
      ok: false
      reason: 'not_configured' | 'rate_limited' | 'offline' | 'unknown'
      detail?: string
    }

/**
 * Creates a blood request, then asks the database to find donors for it.
 *
 * Two steps, on purpose. The request is saved first, so that if matching fails
 * the request still exists and an admin can match it by hand. Losing a request
 * because the matcher had a bad moment would be the worst possible failure for
 * this product.
 *
 * The matcher runs inside Postgres. It reads donor rows, which no browser may
 * do, and it returns only a count and a radius. See migration 0012.
 */
export async function submitRequest(form: RequestForm): Promise<RequestResult> {
  const pending = getSupabase()
  if (!pending) return { ok: false, reason: 'not_configured' }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reason: 'offline' }
  }

  // Chosen here, not read back. See src/lib/id.ts: anon may insert and may not
  // select, and `.select()` after an insert is a read that RLS refuses.
  const requestId = newId()

  const payload = {
    id: requestId,
    requester_name: form.requesterName.trim(),
    requester_phone: form.requesterPhone.trim(),
    requester_whatsapp: form.requesterWhatsapp.trim() || null,
    requester_email: form.requesterEmail.trim() || null,

    blood_group: form.bloodGroup,
    units_needed: Math.max(1, Math.min(20, Number(form.unitsNeeded) || 1)),
    urgency: form.urgency,

    hospital_id: form.hospitalId,
    hospital_name_free_text: form.hospitalFreeText.trim() || null,
    district_id: form.districtId,
    upazila_id: form.upazilaId,
    lat: form.coords?.lat ?? null,
    lng: form.coords?.lng ?? null,

    needed_by: form.neededBy ? new Date(form.neededBy).toISOString() : null,
    patient_note: form.patientNote.trim() || null,
    status: 'open' as const,
  }

  try {
    const supabase = await pending
    const { error } = await supabase.from('blood_requests').insert(payload)

    if (error) {
      if (error.message?.includes('rate_limit_exceeded')) {
        return { ok: false, reason: 'rate_limited' }
      }
      // The visitor gets a calm sentence; whoever is looking at the console
      // gets the actual reason. Without this the only symptom of a schema or
      // policy problem is "try again later", which is unfixable from outside.
      console.error('Could not create the blood request:', error.message, error)
      return { ok: false, reason: 'unknown', detail: error.message }
    }
  } catch (err) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { ok: false, reason: 'offline' }
    }
    return { ok: false, reason: 'unknown', detail: err instanceof Error ? err.message : undefined }
  }

  // The request is saved from here on. Everything below is a degraded success
  // at worst, so the caller always gets a request id back.
  //
  // Preferred path: the Edge Function. It is the only place that can see the
  // caller's IP address, so it is the only place the per-hour cap can actually
  // be enforced. It also runs the matcher and queues the emails.
  const viaFunction = await callFunction<{
    ok: boolean
    matched: number
    queued: number
    radius_km: number | null
    whole_district: boolean
    auto_email_enabled: boolean
  }>('send-request-emails', { request_id: requestId })

  if (viaFunction.ok && viaFunction.data.ok) {
    return {
      ok: true,
      requestId,
      match: {
        matched_count: viaFunction.data.matched,
        radius_km: viaFunction.data.radius_km,
        widened: viaFunction.data.whole_district,
        emails_queued: viaFunction.data.auto_email_enabled,
      },
    }
  }

  if (viaFunction.ok === false && viaFunction.status === 429) {
    // The request row exists but the caller is over the cap. Say so honestly
    // rather than reporting a match that never ran.
    return { ok: false, reason: 'rate_limited' }
  }

  // Fallback for a deployment where the functions are not published yet.
  // Matching still runs, so admins can send by hand; only the IP cap and the
  // emails are missing.
  try {
    const supabase = await pending
    const { data, error } = await supabase
      .rpc('run_request_matcher', { in_request_id: requestId })
      .maybeSingle()
    if (error) throw error
    return { ok: true, requestId, match: (data as MatchOutcome | null) ?? null }
  } catch {
    return { ok: true, requestId, match: null }
  }
}
