import { getSupabase } from '@/lib/supabase'
import type { DonorForm } from './validation'
import { normalisePhone } from './validation'

export type SubmitResult =
  | { ok: true; donorId: string }
  | { ok: false; reason: 'not_configured' | 'duplicate_phone' | 'rate_limited' | 'offline' | 'unknown'; detail?: string }

/**
 * Writes a donor row.
 *
 * The browser inserts directly, which is what the anon INSERT policy in
 * migration 0009 allows. The row cannot arrive verified, blocked, or with a
 * donation count, because the policy's WITH CHECK forbids it.
 *
 * Not sent, on purpose: ip_hash. A browser cannot see its own public address,
 * and asking a third party for it would leak the registration to them. That
 * means the per-IP rate limit trigger has nothing to key on for now and lets
 * the row through; the honeypot and the timing check are what stand in front
 * of it. Populating ip_hash properly needs the registration to go through an
 * Edge Function, which arrives with the rest of them.
 */
export async function submitDonor(form: DonorForm): Promise<SubmitResult> {
  const pending = getSupabase()
  if (!pending) return { ok: false, reason: 'not_configured' }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reason: 'offline' }
  }

  const phone = normalisePhone(form.phone)
  if (!phone) return { ok: false, reason: 'unknown', detail: 'phone' }

  const whatsapp = form.whatsapp.trim() ? normalisePhone(form.whatsapp) : null

  const payload = {
    full_name: form.fullName.trim(),
    // Blank means "use my first name", which the database trigger applies, so
    // nobody publishes their full legal name by accident.
    display_name: form.displayName.trim() || null,
    blood_group: form.bloodGroup,

    phone,
    whatsapp,
    email: form.email.trim() || null,
    facebook_url: form.facebookUrl.trim() || null,

    district_id: form.districtId,
    upazila_id: form.upazilaId,
    address_line: form.addressLine.trim() || null,

    // The true position. The public only ever sees the fuzzed pair, which a
    // trigger derives from these before the row is visible to anything.
    lat: form.coords?.lat ?? null,
    lng: form.coords?.lng ?? null,

    date_of_birth: form.dateOfBirth || null,
    weight_kg: form.weightKg ? Number(form.weightKg) : null,
    last_donation_date: form.lastDonationDate || null,

    consent_email: form.consentEmail,
    consent_public_listing: form.consentPublicListing,

    verified: false,
    blocked: false,
    total_donations: 0,
  }

  try {
    const supabase = await pending
    const { data, error } = await supabase
      .from('donors')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      // 23505 unique_violation: the phone number is already registered.
      if (error.code === '23505') return { ok: false, reason: 'duplicate_phone' }
      if (error.message?.includes('rate_limit_exceeded')) {
        return { ok: false, reason: 'rate_limited' }
      }
      return { ok: false, reason: 'unknown', detail: error.message }
    }

    return { ok: true, donorId: (data as { id: string }).id }
  } catch (err) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { ok: false, reason: 'offline' }
    }
    return { ok: false, reason: 'unknown', detail: err instanceof Error ? err.message : undefined }
  }
}
