import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import {
  adminClient,
  json,
  preflight,
  readSettings,
  settingInt,
  settingString,
} from '../_shared/util.ts'

/**
 * Sends whatever is due in email_queue, slowly and within the daily cap.
 *
 * Called on a schedule: either pg_cron (migration 0010) or the GitHub Actions
 * workflow. Both are fine; running both means every email gets two attempts at
 * once, so pick one.
 *
 * Free Gmail allows roughly 500 recipients a day. daily_email_cap defaults to
 * 400, which leaves headroom for the account being used for anything else.
 * Going over does not bounce a message, it locks the account for 24 hours,
 * which would take the whole service down.
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
}

Deno.serve(async (req) => {
  const cors = preflight(req)
  if (cors) return cors

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

  const supabase = adminClient()

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
      .select('id, to_email, subject, html_body, text_body, attempts')
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
    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPassword },
      },
    })

    let sent = 0
    let failed = 0

    try {
      for (const row of rows) {
        try {
          await client.send({
            from: `${senderName} <${gmailUser}>`,
            to: row.to_email,
            subject: row.subject,
            // Both parts, always. Plenty of clients here show only the text
            // one, and Gmail on Android falls back to it when HTML is heavy.
            content: row.text_body,
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
          // matcher both see the truth.
          await supabase
            .from('request_recipients')
            .update({ email_status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', (await recipientIdFor(supabase, row.id)) ?? '')

          sent++
        } catch (err) {
          failed++
          const attempts = row.attempts + 1
          const message = err instanceof Error ? err.message : String(err)

          if (attempts >= MAX_ATTEMPTS) {
            // Give up and make it visible. A silently dropped email about a
            // blood request is the worst kind of failure here.
            await supabase
              .from('email_queue')
              .update({ status: 'failed', attempts, last_error: message })
              .eq('id', row.id)

            const recipientId = await recipientIdFor(supabase, row.id)
            if (recipientId) {
              await supabase
                .from('request_recipients')
                .update({ email_status: 'failed' })
                .eq('id', recipientId)
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
        }
      }
    } finally {
      await client.close()
    }

    return json({ ok: true, sent, failed, expired, considered: rows.length, remaining_before: remaining })
  } catch (err) {
    console.error('drain-email-queue failed', err)
    return json({ error: 'internal_error' }, 500)
  }
})

/** The queue row knows its recipient; this keeps the update readable. */
async function recipientIdFor(
  supabase: ReturnType<typeof adminClient>,
  queueId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('email_queue')
    .select('recipient_id')
    .eq('id', queueId)
    .maybeSingle()
  return (data?.recipient_id as string | null) ?? null
}
