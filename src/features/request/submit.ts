import { getSupabase } from '@/lib/supabase'
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

  const payload = {
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

  let requestId: string
  try {
    const supabase = await pending
    const { data, error } = await supabase
      .from('blood_requests')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      if (error.message?.includes('rate_limit_exceeded')) {
        return { ok: false, reason: 'rate_limited' }
      }
      return { ok: false, reason: 'unknown', detail: error.message }
    }
    requestId = (data as { id: string }).id
  } catch (err) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { ok: false, reason: 'offline' }
    }
    return { ok: false, reason: 'unknown', detail: err instanceof Error ? err.message : undefined }
  }

  // The request is saved from here on. Matching failing is a degraded success,
  // not a failure, so the caller still gets a request id.
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
