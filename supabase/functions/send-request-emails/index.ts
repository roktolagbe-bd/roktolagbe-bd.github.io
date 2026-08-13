import {
  adminClient,
  errorPayload,
  hashedCallerIp,
  json,
  preflight,
  readSettings,
  settingBool,
  settingInt,
} from '../_shared/util.ts'
import {
  donorRequestEmail,
  requesterConfirmationEmail,
  type Urgency,
} from '../_shared/templates.ts'

/**
 * Turns a blood request into queued emails.
 *
 * Call it with { request_id } right after the request row is created.
 *
 * The first thing it does, before any work, is read auto_email_enabled. When
 * that is false it still runs the matcher in full and leaves every recipient
 * as 'skipped', so an admin can see exactly who would have been contacted and
 * send by hand. Nothing is lost by leaving the switch off, which is why it
 * ships off.
 *
 * Nothing is sent from here. Everything goes into email_queue and is drained
 * on a schedule, because 25 messages arriving at Gmail in one second is how an
 * account gets locked.
 */
Deno.serve(async (req) => {
  const cors = preflight(req)
  if (cors) return cors

  let requestId: string
  try {
    const body = await req.json()
    requestId = String(body.request_id ?? '')
    if (!requestId) return json({ error: 'request_id is required' }, 400)
  } catch {
    return json({ error: 'expected a JSON body' }, 400)
  }

  const supabase = adminClient()

  // Updated as the function moves through the pipeline. It is what turns
  // "internal_error" into "internal_error at queue_donor_emails", which is the
  // difference between two days of guessing and one look.
  let stage = 'start'

  try {
    // ---- Rate limit, keyed on a hash the caller never sees ----------------
    // This is the only place the limit can actually be applied: a browser
    // cannot see its own public address, and asking a third party for it would
    // leak the request to them.
    //
    // Salted and hashed here rather than in Postgres, so the address itself
    // never reaches the database. Null means no digest could be made (no
    // address, or IP_SALT unset), and the honeypot and timing checks stand.
    stage = 'rate_limit'
    const ipHash = await hashedCallerIp(req)
    if (ipHash) {
      const { data: allowed } = await supabase.rpc('check_and_record_ip', {
        in_ip_hash: ipHash,
        in_kind: 'request',
        in_target_id: requestId,
      })
      if (allowed === false) {
        return json({ error: 'rate_limited' }, 429)
      }
    }

    stage = 'read_settings'
    const settings = await readSettings(supabase)
    const autoEmail = settingBool(settings, 'auto_email_enabled', false)
    const maxEmails = settingInt(settings, 'max_emails_per_request', 25)
    const dailyCap = settingInt(settings, 'daily_email_cap', 400)

    // ---- Match. Idempotent, so a retry cannot double-contact anyone -------
    stage = 'run_matcher'
    const { data: matchRows, error: matchError } = await supabase
      .rpc('run_request_matcher', { in_request_id: requestId })
      .maybeSingle()
    if (matchError) throw matchError

    const match = (matchRows ?? {
      matched_count: 0,
      radius_km: null,
      widened: false,
      emails_queued: autoEmail,
    }) as {
      matched_count: number
      radius_km: number | null
      widened: boolean
      emails_queued: boolean
    }

    if (!autoEmail) {
      // Matching happened; sending did not. Say so precisely rather than
      // implying either more or less than what occurred.
      return json({
        ok: true,
        auto_email_enabled: false,
        matched: match.matched_count,
        queued: 0,
        radius_km: match.radius_km,
        whole_district: match.widened,
        note: 'Matching ran and recipients were recorded as skipped. No email was queued.',
      })
    }

    // ---- Respect the daily cap before writing anything --------------------
    stage = 'check_quota'
    const { data: remainingRows } = await supabase.rpc('email_quota_remaining')
    const remaining = typeof remainingRows === 'number' ? remainingRows : dailyCap
    if (remaining <= 0) {
      return json({
        ok: true,
        matched: match.matched_count,
        queued: 0,
        quota_exhausted: true,
        note: 'Daily email cap reached. Recipients are recorded and can be sent tomorrow.',
      })
    }

    const budget = Math.min(maxEmails, remaining)

    // ---- Render and queue -------------------------------------------------
    stage = 'load_recipients'
    const { data: pending, error: pendingError } = await supabase.rpc('pending_donor_emails', {
      in_request_id: requestId,
      in_limit: budget,
    })
    if (pendingError) throw pendingError

    type Pending = {
      recipient_id: string
      donor_email: string
      donor_name: string
      opt_out_token: string
      response_token: string
      distance_km: number | null
      blood_group: string
      units_needed: number
      urgency: Urgency
      hospital_name: string | null
      district_name: string | null
      needed_by: string | null
      patient_note: string | null
      requester_name: string
      request_lat: number | null
      request_lng: number | null
    }

    const rows = (pending ?? []) as Pending[]
    const queue = rows.map((row) => {
      const email = donorRequestEmail({
        donorName: row.donor_name,
        bloodGroup: row.blood_group,
        unitsNeeded: row.units_needed,
        urgency: row.urgency,
        hospitalName: row.hospital_name,
        districtName: row.district_name,
        neededBy: row.needed_by,
        distanceKm: row.distance_km,
        patientNote: row.patient_note,
        requesterName: row.requester_name,
        requestLat: row.request_lat,
        requestLng: row.request_lng,
        responseToken: row.response_token,
        optOutToken: row.opt_out_token,
      })

      return {
        to_email: row.donor_email,
        subject: email.subject,
        html_body: email.html,
        text_body: email.text,
        request_id: requestId,
        recipient_id: row.recipient_id,
        kind: 'donor_request',
      }
    })

    stage = 'queue_donor_emails'
    let queued = 0
    if (queue.length > 0) {
      // Arbitrated on email_queue.dedupe_key, a generated column with a plain
      // unique index. The two partial indexes this used to name could never
      // arbitrate anything: PostgREST emits ON CONFLICT with no WHERE clause,
      // and Postgres will not match that to a partial index. See migration 0021.
      const { error: insertError, count } = await supabase
        .from('email_queue')
        .upsert(queue, { onConflict: 'dedupe_key', ignoreDuplicates: true, count: 'exact' })
      if (insertError) throw insertError
      queued = count ?? queue.length
    }

    // ---- Tell the requester what happened ---------------------------------
    const { data: request } = await supabase
      .from('blood_requests')
      .select('requester_name, requester_email, blood_group, hospital_name_free_text')
      .eq('id', requestId)
      .maybeSingle()

    if (request?.requester_email) {
      const confirmation = requesterConfirmationEmail({
        requesterName: request.requester_name,
        bloodGroup: request.blood_group,
        notified: match.matched_count,
        radiusKm: match.radius_km,
        wholeDistrict: match.widened,
        hospitalName: request.hospital_name_free_text,
      })

      stage = 'queue_requester_confirmation'
      const { error: confirmError } = await supabase.from('email_queue').upsert(
        [
          {
            to_email: request.requester_email,
            subject: confirmation.subject,
            html_body: confirmation.html,
            text_body: confirmation.text,
            request_id: requestId,
            recipient_id: null,
            kind: 'requester_confirmation',
          },
        ],
        { onConflict: 'dedupe_key', ignoreDuplicates: true },
      )
      // Logged rather than thrown: the donors are already queued and that is
      // the part that saves a life. But it is no longer silent — this upsert
      // had the same broken arbiter and nobody would have known.
      if (confirmError) console.error('requester confirmation not queued', confirmError)
    }

    return json({
      ok: true,
      auto_email_enabled: true,
      matched: match.matched_count,
      queued,
      radius_km: match.radius_km,
      whole_district: match.widened,
    })
  } catch (err) {
    console.error(`send-request-emails failed at ${stage}`, err)
    // The request row still exists and the recipients are still recorded, so
    // an admin can send from the panel. Never lose a request over this.
    //
    // The reason comes back with it now. `{"error":"internal_error"}` on the
    // one path that needed debugging is the same self-reporting failure as the
    // matcher's fake zero: the answer was in the logs, visible only to someone
    // who knew to open the Supabase dashboard. errorPayload keeps `details`
    // out, because that is the field Postgres fills with row values.
    return json(errorPayload(err, stage), 500)
  }
})
