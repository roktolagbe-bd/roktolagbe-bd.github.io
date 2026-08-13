import { SmtpConnection, SmtpError } from '../_shared/smtp.ts'
import {
  adminClient,
  drainSecretCheck,
  errorPayload,
  json,
  preflight,
  readSettings,
  settingInt,
  settingString,
} from '../_shared/util.ts'

/**
 * Sends whatever is due in email_queue, slowly and within the daily cap.
 *
 * Called on a schedule: either pg_cron (supabase/optional/cron_schedule.sql)
 * or the GitHub Actions workflow. Both are fine; running both means every
 * email gets two attempts at once, so pick one.
 *
 * Whichever calls it must present DRAIN_SECRET in an x-drain-secret header.
 * That secret only proves the caller may ask for a drain; it is not a database
 * credential and grants nothing else.
 *
 * Free Gmail allows roughly 500 recipients a day. daily_email_cap defaults to
 * 400, which leaves headroom for the account being used for anything else.
 * Going over does not bounce a message, it locks the account for 24 hours,
 * which would take the whole service down.
 *
 * The message itself is built by _shared/mime.ts and written to the socket by
 * _shared/smtp.ts. denomailer used to do both and got both wrong: it
 * double-encoded the From header, and it folded a long Bangla Subject into a
 * blank line, which ends the header block, which is why From, To, Date,
 * MIME-Version and Content-Type all arrived as body text.
 */

const BATCH_SIZE = 20
const MAX_ATTEMPTS = 3

/* Backoff between attempts. Three tries over roughly an hour is enough to ride
   out a temporary Gmail refusal without hammering it. */
const BACKOFF_MINUTES = [5, 20, 60]

type QueueRow = {
  id: string
  to_email: string
  subject: string
  html_body: string
  text_body: string
  attempts: number
  recipient_id: string | null
}

Deno.serve(async (req) => {
  const cors = preflight(req)
  if (cors) return cors

  // Before anything else, and before any work that costs money or sends mail.
  // This endpoint is not for browsers: the only thing that should reach it is
  // whatever runs the schedule, holding DRAIN_SECRET.
  const denied = await drainSecretCheck(req)
  if (denied) return denied

  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPassword = Deno.env.get('GMAIL_APP_PASSWORD')

  if (!gmailUser || !gmailPassword) {
    return json(
      {
        error: 'not_configured',
        note: 'Set GMAIL_USER and GMAIL_APP_PASSWORD in Supabase Edge Function secrets.',
      },
      500,
    )
  }

  const smtp = {
    hostname: 'smtp.gmail.com',
    port: 465,
    username: gmailUser,
    password: gmailPassword,
  }

  const supabase = adminClient()

  // ---- A real test message, on demand ------------------------------------
  //
  // POST {"test_to":"you@gmail.com"} and this sends one bilingual message
  // straight away, bypassing the queue entirely. It exists because the only
  // way to know whether Bangla renders in a real inbox is to look at a real
  // inbox: reading the generated string proves nothing, which is how a From
  // header full of raw UTF-8 shipped, and then how a double-encoded one did.
  //
  // Behind DRAIN_SECRET like everything else here, so it is not a way for a
  // stranger to send mail from this address.
  try {
    const body = await req.clone().json().catch(() => ({}))
    const testTo = typeof body?.test_to === 'string' ? body.test_to.trim() : ''

    if (testTo) {
      const settings = await readSettings(supabase)
      const senderName = settingString(settings, 'sender_name', 'রক্ত লাগবে')

      const client = await SmtpConnection.connect(smtp)
      try {
        await client.send({
          fromName: senderName,
          fromAddress: gmailUser,
          to: testTo,
          subject: 'রক্ত লাগবে — পরীক্ষামূলক বার্তা / test message',
          text: [
            'এটি একটি পরীক্ষামূলক বার্তা।',
            'বাংলা ঠিকভাবে দেখা যাচ্ছে কি? যুক্তাক্ষর: ক্ত ক্ষ ঙ্গ জ্ঞ',
            '',
            'This is a test message. If the subject line above reads as Bangla',
            'and not as =?utf-8?..., the header encoding is correct.',
            'If this paragraph is the whole body — no From, To or Date lines',
            'above it — the header block survived folding.',
          ].join('\n'),
          html:
            '<p style="font-size:16px">এটি একটি পরীক্ষামূলক বার্তা।</p>' +
            '<p>যুক্তাক্ষর: ক্ত ক্ষ ঙ্গ জ্ঞ</p>' +
            '<p>If the subject reads as Bangla, this paragraph is not full of ' +
            '<code>=E0=A6</code> escapes, and there are no <code>From:</code> or ' +
            '<code>Date:</code> lines above it, the message is correct.</p>',
        })
      } finally {
        await client.close()
      }

      // The address is returned so it can be compared against what the inbox
      // shows. GMAIL_USER is a Supabase secret, not something in this repo, so
      // this is the only way to see which address is actually configured.
      return json({ ok: true, test_sent_to: testTo, sent_as: gmailUser })
    }
  } catch (err) {
    console.error('test send failed', err)
    return json(errorPayload(err, 'test_send'), 500)
  }

  try {
    // ---- Housekeeping, before anything that can return early -------------
    // Here rather than at the end because the common case by far is "nothing
    // due", which returns above the send loop. Expiry that only ran on busy
    // minutes would almost never run at all.
    //
    // It lives in the drainer so it does not depend on which drainer is in
    // use: pg_cron schedules its own hourly sweep, the Actions workflow has no
    // way to schedule one, and without this a project using the workflow never
    // expires anything. Idempotent, so doing it on both paths is harmless.
    //
    // Its failure must never fail a drain: sending mail is the job, tidying up
    // is not.
    let expired = 0
    try {
      const { data } = await supabase.rpc('expire_old_requests')
      expired = typeof data === 'number' ? data : 0
    } catch (err) {
      console.error('expire_old_requests failed', err)
    }

    const settings = await readSettings(supabase)
    const dailyCap = settingInt(settings, 'daily_email_cap', 400)
    const senderName = settingString(settings, 'sender_name', 'রক্ত লাগবে')

    // ---- How much of today's allowance is left ---------------------------
    const { data: remainingRaw } = await supabase.rpc('email_quota_remaining')
    const remaining = typeof remainingRaw === 'number' ? remainingRaw : dailyCap
    if (remaining <= 0) {
      return json({ ok: true, sent: 0, failed: 0, expired, note: 'Daily cap reached.' })
    }

    const batch = Math.min(BATCH_SIZE, remaining)

    const { data: due, error: dueError } = await supabase
      .from('email_queue')
      .select('id, to_email, subject, html_body, text_body, attempts, recipient_id')
      .eq('status', 'queued')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(batch)

    if (dueError) throw dueError
    const rows = (due ?? []) as QueueRow[]
    if (rows.length === 0) {
      return json({ ok: true, sent: 0, failed: 0, expired, note: 'Nothing due.' })
    }

    // ---- One SMTP connection for the whole batch --------------------------
    // Opening a connection per message is what makes Gmail treat a burst as
    // abuse.
    //
    // Connecting can fail on its own — a wrong App Password refuses every
    // message equally. When that happens the rows are left ALONE: recording an
    // attempt against each would burn all three on a configuration mistake and
    // permanently fail a queue full of perfectly good mail. The reason is
    // written to last_error so it is visible in the admin panel, and the rows
    // stay due.
    let client: SmtpConnection
    try {
      client = await SmtpConnection.connect(smtp)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await supabase
        .from('email_queue')
        .update({ last_error: message })
        .in('id', rows.map((row) => row.id))
      throw err
    }

    let sent = 0
    let failed = 0

    try {
      for (const row of rows) {
        try {
          await client.send({
            fromName: senderName,
            fromAddress: gmailUser,
            to: row.to_email,
            subject: row.subject,
            // Both parts, always. Plenty of clients here show only the text
            // one, and Gmail on Android falls back to it when HTML is heavy.
            text: row.text_body,
            html: row.html_body,
          })

          await supabase
            .from('email_queue')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              attempts: row.attempts + 1,
              last_error: null,
            })
            .eq('id', row.id)

          // Mark the donor's recipient row as sent so the admin panel and the
          // matcher both see the truth. Requester confirmations have no
          // recipient row, and passing an empty string to a uuid column is an
          // error rather than a no-op, so the null case has to be skipped.
          if (row.recipient_id) {
            await supabase
              .from('request_recipients')
              .update({ email_status: 'sent', sent_at: new Date().toISOString() })
              .eq('id', row.recipient_id)
          }

          sent++
        } catch (err) {
          failed++
          const attempts = row.attempts + 1
          const message = err instanceof Error ? err.message : String(err)

          // A 5xx will be a 5xx in twenty minutes too. Retrying a rejected
          // address spends the daily quota and teaches Gmail that this sender
          // retries mail it has already been told to stop sending.
          const permanent = err instanceof SmtpError && err.permanent

          if (permanent || attempts >= MAX_ATTEMPTS) {
            // Give up and make it visible. A silently dropped email about a
            // blood request is the worst kind of failure here.
            await supabase
              .from('email_queue')
              .update({ status: 'failed', attempts, last_error: message })
              .eq('id', row.id)

            if (row.recipient_id) {
              await supabase
                .from('request_recipients')
                .update({ email_status: 'failed' })
                .eq('id', row.recipient_id)
            }
          } else {
            const wait = BACKOFF_MINUTES[attempts - 1] ?? 60
            await supabase
              .from('email_queue')
              .update({
                attempts,
                last_error: message,
                scheduled_for: new Date(Date.now() + wait * 60_000).toISOString(),
              })
              .eq('id', row.id)
          }

          // A refused recipient leaves the session mid-transaction, and the
          // next MAIL FROM would be refused too. Without this, one bad address
          // fails the whole rest of the batch.
          try {
            await client.reset()
          } catch {
            // The connection is gone; the remaining rows stay due and the next
            // drain picks them up on a fresh one.
            break
          }
        }
      }
    } finally {
      await client.close()
    }

    return json({ ok: true, sent, failed, expired, considered: rows.length, remaining_before: remaining })
  } catch (err) {
    console.error('drain-email-queue failed', err)
    return json(errorPayload(err, 'drain-email-queue'), 500)
  }
})
