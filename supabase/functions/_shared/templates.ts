/**
 * Email templates.
 *
 * Written as nested tables with inline styles, which looks like 2005 and is
 * correct. Gmail on Android strips <style> blocks, ignores flexbox and grid,
 * and drops most classes. Anything clever here would arrive as a wall of
 * unstyled text on the exact devices most of our donors use.
 *
 * Rules that shaped these:
 *   - Every email is bilingual, Bangla first. Somebody woken at 2am should not
 *     have to read English.
 *   - Every email has a plain text alternative. Some Bangladeshi mail clients
 *     and most smartwatches show only that.
 *   - Every donor email carries a one-click opt out.
 *   - Buttons are table cells with background colours, not <button> or CSS
 *     buttons, because those do not render.
 *   - No images. They are blocked by default, they cost data on a slow
 *     connection, and a tracking pixel is exactly what we promised not to do.
 */

const SITE = 'https://roktolagbe-bd.github.io'

const INK = '#141310'
const PAPER = '#f3f4f0'
const MUTED = '#63625b'
const SHINDUR = '#c62828'
const NIL = '#2b3f8c'
const JOL = '#0b6f6c'

export type Urgency = 'critical' | 'urgent' | 'scheduled'

const URGENCY_BN: Record<Urgency, string> = {
  critical: 'এখনই দরকার',
  urgent: 'জরুরি',
  scheduled: 'আগে থেকে ঠিক করা',
}
const URGENCY_EN: Record<Urgency, string> = {
  critical: 'Needed right now',
  urgent: 'Urgent',
  scheduled: 'Planned',
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** 8801712345678 -> https://wa.me/8801712345678 */
export function whatsappLink(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 11) return null
  return `https://wa.me/${digits.startsWith('88') ? digits : `88${digits}`}`
}

/** No API key needed, and it opens in whatever map app the phone has. */
export function mapsLink(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null
  return `https://www.google.com/maps?q=${lat},${lng}`
}

export function formatWhen(value: string | null): { bn: string; en: string } | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  }
  return {
    bn: new Intl.DateTimeFormat('bn-BD', options).format(date),
    en: new Intl.DateTimeFormat('en-GB', options).format(date),
  }
}

/* A table-based button. The padding lives on the cell, so the whole coloured
   area is tappable even in clients that shrink the anchor. */
function button(href: string, label: string, background: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;">
    <tr>
      <td align="center" bgcolor="${background}" style="border-radius:4px;border:2px solid ${INK};">
        <a href="${escapeHtml(href)}"
           style="display:block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`
}

function shell(bodyHtml: string, footerHtml: string): string {
  return `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>রক্ত লাগবে</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPER};">
  <tr>
    <td align="center" style="padding:16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;background-color:#ffffff;border:2px solid ${INK};">
        <tr>
          <td style="padding:16px 20px;border-bottom:2px solid ${INK};font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:${INK};">
            রক্ত লাগবে
            <span style="font-weight:normal;color:${MUTED};font-size:14px;">&nbsp;Roktolagbe</span>
          </td>
        </tr>
        <tr><td style="padding:20px;">${bodyHtml}</td></tr>
        <tr>
          <td style="padding:16px 20px;border-top:2px solid ${INK};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${MUTED};">
            ${footerHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

const p = (bn: string, en: string) => `
  <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:${INK};">${bn}</p>
  <p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:${MUTED};">${en}</p>`

const row = (label: string, value: string) => `
  <tr>
    <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED};width:40%;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${INK};font-weight:bold;">${value}</td>
  </tr>`

// ---------------------------------------------------------------------------
// 1. To a donor: someone nearby needs your blood group
// ---------------------------------------------------------------------------

export type DonorEmailInput = {
  donorName: string
  bloodGroup: string
  unitsNeeded: number
  urgency: Urgency
  hospitalName: string | null
  districtName: string | null
  neededBy: string | null
  distanceKm: number | null
  patientNote: string | null
  requesterName: string
  requestLat: number | null
  requestLng: number | null
  responseToken: string
  optOutToken: string
}

export function donorRequestEmail(input: DonorEmailInput) {
  const accept = `${SITE}/respond/${input.responseToken}?a=yes`
  const decline = `${SITE}/respond/${input.responseToken}?a=no`
  const optOut = `${SITE}/opt-out/${input.optOutToken}`
  const maps = mapsLink(input.requestLat, input.requestLng)
  const when = formatWhen(input.neededBy)
  const place = input.hospitalName ?? input.districtName ?? ''
  const distance = input.distanceKm != null ? `${input.distanceKm} km` : null

  // Urgency and group lead the subject line, because that is all that shows
  // in a phone notification.
  const subject =
    input.urgency === 'critical'
      ? `জরুরি: ${input.bloodGroup} রক্ত দরকার — ${place}`
      : `${input.bloodGroup} রক্ত দরকার — ${place}`

  const html = shell(
    `
    ${p(
      `${escapeHtml(input.donorName)}, আপনার কাছে একজনের <strong>${escapeHtml(input.bloodGroup)}</strong> রক্ত দরকার।`,
      `${escapeHtml(input.donorName)}, someone near you needs <strong>${escapeHtml(input.bloodGroup)}</strong> blood.`,
    )}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="border:2px solid ${INK};background-color:${PAPER};margin:0 0 20px 0;">
      <tr><td style="padding:14px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${row('রক্তের গ্রুপ / Blood group', `<span style="color:${SHINDUR};">${escapeHtml(input.bloodGroup)}</span>`)}
          ${row('কত ব্যাগ / Units', escapeHtml(String(input.unitsNeeded)))}
          ${row('জরুরি কতটা / Urgency', `${escapeHtml(URGENCY_BN[input.urgency])} &middot; ${escapeHtml(URGENCY_EN[input.urgency])}`)}
          ${place ? row('হাসপাতাল / Hospital', escapeHtml(place)) : ''}
          ${when ? row('কখন / Needed by', `${escapeHtml(when.bn)}`) : ''}
          ${distance ? row('আপনার থেকে দূরত্ব / Distance', escapeHtml(distance)) : ''}
          ${row('যিনি চাইছেন / Requested by', escapeHtml(input.requesterName))}
        </table>
      </td></tr>
    </table>

    ${
      input.patientNote
        ? `<p style="margin:0 0 20px 0;padding:12px 14px;border-left:4px solid ${MUTED};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:${INK};background-color:${PAPER};">${escapeHtml(input.patientNote)}</p>`
        : ''
    }

    ${p(
      'আপনি কি পারবেন? নিচের যেকোনো একটিতে চাপ দিন। লগইন লাগবে না।',
      'Can you help? Tap one of the buttons below. No login needed.',
    )}

    ${button(accept, 'হ্যাঁ, আমি পারব / Yes, I can', JOL)}
    ${button(decline, 'এখন পারব না / I cannot', MUTED)}

    ${
      maps
        ? `<p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;">
             <a href="${escapeHtml(maps)}" style="color:${NIL};">মানচিত্রে জায়গাটি দেখুন / See the location on a map</a>
           </p>`
        : ''
    }

    ${p(
      'হ্যাঁ বললে তখনই আপনার ফোন নম্বর শুধু ওই একজনকে দেওয়া হবে। আর কাউকে নয়।',
      'If you say yes, your phone number goes to that one person and nobody else.',
    )}
  `,
    `
    <a href="${escapeHtml(optOut)}" style="color:${MUTED};">এই ইমেইল আর পেতে চাই না / Stop these emails</a><br>
    রক্ত লাগবে একটি বিনামূল্যের, খোলা সোর্সের প্রকল্প। ${escapeHtml(SITE)}
  `,
  )

  const text = [
    `${input.donorName}, someone near you needs ${input.bloodGroup} blood.`,
    ``,
    `Blood group: ${input.bloodGroup}`,
    `Units: ${input.unitsNeeded}`,
    `Urgency: ${URGENCY_EN[input.urgency]}`,
    place ? `Hospital: ${place}` : '',
    when ? `Needed by: ${when.en}` : '',
    distance ? `Distance from you: ${distance}` : '',
    `Requested by: ${input.requesterName}`,
    input.patientNote ? `Note: ${input.patientNote}` : '',
    ``,
    `YES, I CAN HELP:  ${accept}`,
    `I CANNOT:         ${decline}`,
    maps ? `Location:         ${maps}` : '',
    ``,
    `If you say yes, your phone number goes to that one person and nobody else.`,
    ``,
    `Stop these emails: ${optOut}`,
    SITE,
  ]
    .filter((line) => line !== '')
    .join('\n')

  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// 2. To the requester: your request has gone out
// ---------------------------------------------------------------------------

export function requesterConfirmationEmail(input: {
  requesterName: string
  bloodGroup: string
  notified: number
  radiusKm: number | null
  wholeDistrict: boolean
  hospitalName: string | null
}) {
  const where = input.wholeDistrict
    ? { bn: 'পুরো জেলায় খোঁজা হয়েছে।', en: 'We searched the whole district.' }
    : input.radiusKm
      ? {
          bn: `${input.radiusKm} কিলোমিটারের মধ্যে খোঁজা হয়েছে।`,
          en: `We searched within ${input.radiusKm} km.`,
        }
      : { bn: '', en: '' }

  const subject = `আপনার ${input.bloodGroup} রক্তের অনুরোধ পাঠানো হয়েছে`

  const html = shell(
    `
    ${p(
      `${escapeHtml(input.requesterName)}, আপনার অনুরোধ <strong>${input.notified}</strong> জন রক্তদাতার কাছে পাঠানো হয়েছে।`,
      `${escapeHtml(input.requesterName)}, your request has gone to <strong>${input.notified}</strong> donors.`,
    )}
    ${where.bn ? p(where.bn, where.en) : ''}
    ${p(
      'কেউ হ্যাঁ বললে সঙ্গে সঙ্গে আপনাকে আরেকটি ইমেইল পাঠাব, তাতে তাঁর ফোন নম্বর থাকবে। তার আগে কারও নম্বর দেওয়া হয় না।',
      'When someone says yes we will email you straight away with their phone number. Nobody’s number is shared before that.',
    )}
    ${p(
      'জরুরি অবস্থায় সরাসরি হাসপাতালের ব্লাড ব্যাংকে যোগাযোগ করুন। এই সাইট কোনো চিকিৎসা সেবা নয়।',
      'In an emergency, contact a hospital blood bank directly. This site is not a medical service.',
    )}
  `,
    `রক্ত লাগবে &middot; ${escapeHtml(SITE)}`,
  )

  const text = [
    `${input.requesterName}, your request has gone to ${input.notified} donors.`,
    where.en,
    ``,
    `When someone says yes we will email you straight away with their phone number.`,
    `Nobody's number is shared before that.`,
    ``,
    `In an emergency, contact a hospital blood bank directly.`,
    SITE,
  ]
    .filter((line) => line !== '')
    .join('\n')

  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// 3. To the requester: a donor said yes. This carries the contact details.
// ---------------------------------------------------------------------------

export function acceptanceEmail(input: {
  requesterName: string
  donorName: string
  donorPhone: string
  donorWhatsapp: string | null
  donorDistrict: string | null
  distanceKm: number | null
  bloodGroup: string
}) {
  const wa = whatsappLink(input.donorWhatsapp ?? input.donorPhone)
  const tel = `tel:+${input.donorPhone.replace(/\D/g, '')}`
  const readablePhone = input.donorPhone.startsWith('88')
    ? input.donorPhone.slice(2)
    : input.donorPhone

  const subject = `${input.donorName} আপনাকে ${input.bloodGroup} রক্ত দিতে রাজি`

  const html = shell(
    `
    ${p(
      `<strong>${escapeHtml(input.donorName)}</strong> আপনাকে রক্ত দিতে রাজি হয়েছেন।`,
      `<strong>${escapeHtml(input.donorName)}</strong> has agreed to give blood.`,
    )}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="border:2px solid ${INK};background-color:${PAPER};margin:0 0 20px 0;">
      <tr><td style="padding:14px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${row('নাম / Name', escapeHtml(input.donorName))}
          ${row('রক্তের গ্রুপ / Blood group', escapeHtml(input.bloodGroup))}
          ${row('ফোন / Phone', `<a href="${escapeHtml(tel)}" style="color:${NIL};">${escapeHtml(readablePhone)}</a>`)}
          ${input.donorDistrict ? row('জেলা / District', escapeHtml(input.donorDistrict)) : ''}
          ${input.distanceKm != null ? row('দূরত্ব / Distance', `${escapeHtml(String(input.distanceKm))} km`) : ''}
        </table>
      </td></tr>
    </table>

    ${button(tel, `ফোন করুন / Call ${readablePhone}`, NIL)}
    ${wa ? button(wa, 'হোয়াটসঅ্যাপে বার্তা / Message on WhatsApp', JOL) : ''}

    ${p(
      'এখন আপনি নিজেই যোগাযোগ করুন। আমরা মাঝখানে থাকি না।',
      'Please contact them yourself now. We do not sit in the middle.',
    )}
    ${p(
      'অনুগ্রহ করে এই নম্বরটি অন্য কাউকে দেবেন না এবং শুধু এই রক্তের প্রয়োজনেই ব্যবহার করুন।',
      'Please do not pass this number on, and use it only for this blood request.',
    )}
  `,
    `রক্ত লাগবে &middot; ${escapeHtml(SITE)}`,
  )

  const text = [
    `${input.donorName} has agreed to give blood.`,
    ``,
    `Name:        ${input.donorName}`,
    `Blood group: ${input.bloodGroup}`,
    `Phone:       ${readablePhone}`,
    input.donorDistrict ? `District:    ${input.donorDistrict}` : '',
    input.distanceKm != null ? `Distance:    ${input.distanceKm} km` : '',
    wa ? `WhatsApp:    ${wa}` : '',
    ``,
    `Please contact them yourself now. We do not sit in the middle.`,
    `Please do not pass this number on, and use it only for this blood request.`,
    SITE,
  ]
    .filter((line) => line !== '')
    .join('\n')

  return { subject, html, text }
}

/**
 * "Here is your certificate link again."
 *
 * Only ever sent to an address already on the donor's own row, and only when
 * a phone number matched. The person who typed the number into the form is
 * told nothing either way, so this email is the only place a match is ever
 * visible, and it goes to the donor rather than the asker.
 *
 * No opt-out link. This is not a notification anyone can be subscribed to; it
 * is a reply to a request the donor made about their own record. The opt-out
 * footer belongs on donor_request mail, where there is something to opt out
 * of.
 */
export function certificateLinkEmail(input: { donorName: string; token: string }) {
  const url = `${SITE}/certificate/${encodeURIComponent(input.token)}`

  const html = shell(
    `
    ${p(
      `${escapeHtml(input.donorName)}, আপনার রক্তদাতা সনদের লিংক এই যে।`,
      `${escapeHtml(input.donorName)}, here is the link to your blood donor certificate.`,
    )}
    ${button(url, 'সনদ দেখুন / View certificate', SHINDUR)}
    ${p(
      'লিংকটি গোপন রাখুন। যার কাছে এটি থাকবে সে আপনার নাম, রক্তের গ্রুপ ও এলাকা দেখতে পাবে।',
      'Keep the link private. Anyone holding it can see your name, blood group and area.',
    )}
    ${p(
      'আপনি না চাইলে এই ইমেইলটি কেউ পাঠায়নি — কেউ আপনার নম্বর দিয়ে লিংক চেয়েছিল। কিছু করার দরকার নেই, লিংকটি আগের মতোই আছে।',
      'If you did not ask for this, somebody entered your number on the recovery form. Nothing has changed and there is nothing you need to do.',
    )}`,
    `রক্ত লাগবে &middot; <a href="${SITE}" style="color:${MUTED};">roktolagbe-bd.github.io</a>`,
  )

  const text = [
    `${input.donorName}, আপনার রক্তদাতা সনদের লিংক:`,
    url,
    '',
    'লিংকটি গোপন রাখুন। যার কাছে এটি থাকবে সে আপনার নাম, রক্তের গ্রুপ ও এলাকা দেখতে পাবে।',
    '',
    `${input.donorName}, here is the link to your blood donor certificate:`,
    url,
    '',
    'If you did not ask for this, somebody entered your number on the recovery form.',
    'Nothing has changed and there is nothing you need to do.',
  ].join('\n')

  return { subject: 'আপনার রক্তদাতা সনদ / Your blood donor certificate', html, text }
}
