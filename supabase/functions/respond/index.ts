import { adminClient, json, preflight } from '../_shared/util.ts'
import { acceptanceEmail } from '../_shared/templates.ts'

/**
 * A donor's answer, from the link in their email.
 *
 * Takes { token, accept }. No login, no session: the token is the credential,
 * it is good for one request and one donor, and it stops working the moment
 * the request closes.
 *
 * Two things have to happen together, which is why this is one function:
 * the answer is recorded, and if it is yes, the requester is emailed the
 * donor's contact details. This is the single point in the entire system at
 * which a phone number moves from one person to another.
 */
Deno.serve(async (req) => {
  const cors = preflight(req)
  if (cors) return cors

  let token: string
  let accept: boolean
  try {
    const body = await req.json()
    token = String(body.token ?? '')
    accept = Boolean(body.accept)
    if (!token) return json({ error: 'token is required' }, 400)
  } catch {
    return json({ error: 'expected a JSON body' }, 400)
  }

  const supabase = adminClient()

  try {
    // respond_to_request holds a row lock, so two taps on the same link cannot
    // record two different answers.
    const { data, error } = await supabase
      .rpc('respond_to_request', { in_token: token, in_accept: accept })
      .maybeSingle()

    if (error) throw error

    const result = data as {
      ok: boolean
      requester_name: string | null
      requester_phone: string | null
      requester_whatsapp: string | null
      hospital_name: string | null
    } | null

    if (!result?.ok) {
      // Either the token is wrong, or the request is closed. Both are the same
      // answer to the donor, and neither reveals which.
      return json({ ok: false, reason: 'expired' }, 200)
    }

    if (!accept) {
      return json({ ok: true, accepted: false })
    }

    // ---- Queue the email that carries the donor's number -----------------
    // Failing here must not undo the acceptance: the donor said yes and that
    // is recorded. The requester also sees the acceptance in their own
    // progress view, so a lost email is a degraded success, not a lost donor.
    try {
      const { data: recipient } = await supabase
        .from('request_recipients')
        .select('id')
        .eq('response_token', token)
        .maybeSingle()

      if (recipient?.id) {
        const { data: details } = await supabase
          .rpc('acceptance_details', { in_recipient_id: recipient.id })
          .maybeSingle()

        const d = details as {
          request_id: string
          requester_email: string | null
          requester_name: string
          donor_name: string
          donor_phone: string
          donor_whatsapp: string | null
          donor_district: string | null
          distance_km: number | null
          blood_group: string
        } | null

        if (d?.requester_email) {
          const email = acceptanceEmail({
            requesterName: d.requester_name,
            donorName: d.donor_name,
            donorPhone: d.donor_phone,
            donorWhatsapp: d.donor_whatsapp,
            donorDistrict: d.donor_district,
            distanceKm: d.distance_km,
            bloodGroup: d.blood_group,
          })

          await supabase.from('email_queue').upsert(
            [
              {
                to_email: d.requester_email,
                subject: email.subject,
                html_body: email.html,
                text_body: email.text,
                request_id: d.request_id,
                recipient_id: recipient.id,
                kind: 'requester_acceptance',
              },
            ],
            { onConflict: 'recipient_id,kind', ignoreDuplicates: true },
          )
        }
      }
    } catch (err) {
      console.error('acceptance email could not be queued', err)
    }

    // The donor gets the requester's details so they can ring ahead.
    return json({
      ok: true,
      accepted: true,
      requester_name: result.requester_name,
      requester_phone: result.requester_phone,
      requester_whatsapp: result.requester_whatsapp,
      hospital_name: result.hospital_name,
    })
  } catch (err) {
    console.error('respond failed', err)
    return json({ error: 'internal_error' }, 500)
  }
})
