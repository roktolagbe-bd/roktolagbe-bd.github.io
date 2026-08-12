import { adminClient, json, preflight } from '../_shared/util.ts'
import { certificateLinkEmail } from '../_shared/templates.ts'

/**
 * "I lost my certificate link."
 *
 * The rule this function exists to obey: it must be impossible to learn, from
 * the outside, whether a phone number belongs to a registered donor.
 *
 * That is why it lives here at all. A browser cannot do this lookup, because
 * any RPC anon can call is an RPC anon can call with a million numbers. Here
 * the lookup runs as service_role, behind a response that never varies.
 *
 * Every path below returns the same body with the same status. Matched,
 * unmatched, no email on file, already sent recently, database on fire: the
 * caller is told the same sentence, and only the donor's own inbox ever
 * reflects what actually happened.
 *
 * Timing is not equalised. Distinguishing a hit from a miss by milliseconds
 * over a mobile network in Bangladesh is not a realistic attack, and pretending
 * otherwise with sleeps would cost every honest user real seconds.
 */

// The one response. Declared once so no future edit can accidentally make a
// branch say something more specific.
const SAME_ANSWER = { ok: true } as const

function normaliseBdPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  // Stored as plain international digits, matching what the form writes.
  if (/^8801[3-9]\d{8}$/.test(digits)) return digits
  if (/^01[3-9]\d{8}$/.test(digits)) return `88${digits}`
  if (/^1[3-9]\d{8}$/.test(digits)) return `880${digits}`
  // Anything else may still be a valid overseas number the donor registered.
  if (digits.length >= 8 && digits.length <= 15) return digits
  return null
}

Deno.serve(async (req) => {
  const cors = preflight(req)
  if (cors) return cors

  let phone: string
  try {
    const body = await req.json()
    phone = String(body.phone ?? '')
  } catch {
    return json(SAME_ANSWER)
  }

  const normalised = normaliseBdPhone(phone)
  if (!normalised) return json(SAME_ANSWER)

  try {
    const supabase = adminClient()

    const { data: target } = await supabase
      .rpc('certificate_recovery_target', { in_phone: normalised })
      .maybeSingle()

    if (!target) return json(SAME_ANSWER)

    const donor = target as {
      donor_email: string
      certificate_token: string
      display_name: string | null
    }

    // One per address per hour. The response is identical either way, so this
    // is not hiding anything; it is stopping the form being used to bury
    // somebody's inbox.
    const { data: recently } = await supabase.rpc('certificate_link_recently_sent', {
      in_email: donor.donor_email,
    })
    if (recently === true) return json(SAME_ANSWER)

    const email = certificateLinkEmail({
      donorName: donor.display_name ?? 'রক্তদাতা',
      token: donor.certificate_token,
    })

    // Queued rather than sent, like everything else. The drainer owns the SMTP
    // connection and the daily cap.
    await supabase.from('email_queue').insert({
      to_email: donor.donor_email,
      subject: email.subject,
      html_body: email.html,
      text_body: email.text,
      request_id: null,
      recipient_id: null,
      kind: 'certificate_link',
    })

    return json(SAME_ANSWER)
  } catch (err) {
    // Logged, never surfaced. An error that only appears for real numbers
    // would be a way to test numbers.
    console.error('certificate-link failed', err)
    return json(SAME_ANSWER)
  }
})
