/**
 * Everything about how an email is built and sent, checked by executing it.
 *
 *   node scripts/diagnostics/mail-test.mjs
 *
 * Three days were spent on mail that was accepted by Gmail, passed SPF, DKIM
 * and DMARC, and arrived unreadable. Every check along the way said it worked,
 * because every check was "the string looks right to me". It was not right, in
 * three different ways, and none of them were visible by reading.
 *
 * So this script does not read anything. It builds real messages, hands them
 * to mailparser — an independent MIME parser that had no part in writing them
 * — and asks what came out the other side. Then it opens a real SMTP
 * conversation with a server that answers like Gmail does, and checks what
 * that server actually received.
 *
 * The three faults it exists to catch, all of which shipped:
 *
 *   1. Raw Bangla bytes in the From header. A header is US-ASCII by
 *      definition, so the header block ended there and From, To, Date,
 *      MIME-Version and Content-Type all arrived as body text.
 *   2. A From header encoded by us and then encoded AGAIN by the mail library,
 *      arriving as =?utf-8?Q?=3d?utf-8?B?...=3d=3d?=3d?=.
 *   3. A long Bangla Subject folded by the mail library into a BLANK LINE.
 *      A blank line is exactly how RFC 5322 says the header block ends.
 *
 * The last one is why this project no longer lets a library build the header
 * block at all. See supabase/functions/_shared/mime.ts.
 *
 * TLS is not tested here. Deno.connectTls does that, it is not our code, and a
 * self-signed certificate that expires would make this script fail for a
 * reason that has nothing to do with mail. What is tested is everything we
 * wrote: encoding, folding, the reply state machine, the envelope, DATA and
 * dot-stuffing.
 */

import net from 'node:net'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHARED = path.resolve(HERE, '../../supabase/functions/_shared')

let simpleParser
try {
  ;({ simpleParser } = await import('mailparser'))
} catch {
  console.error(
    'mailparser is not installed. It is the independent parser this script\n' +
      'checks against — without it the test would only be our own code agreeing\n' +
      'with itself, which is how the broken version passed.\n\n' +
      '  npm install\n',
  )
  process.exit(2)
}

let bad = 0
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok    ${name}`)
  else {
    bad++
    console.log(`  FAIL  ${name}${extra}`)
  }
}

// Node runs TypeScript directly since 22.18, so these are the files that
// actually ship — not a copy that can drift away from them.
const { build, dotStuff } = await import(path.join(SHARED, 'mime.ts'))

const SENDER = 'রক্ত লাগবে'
const ADDRESS = 'roktolagbebd@gmail.com'

// ---------------------------------------------------------------------------
console.log('\nMessage construction\n')
// ---------------------------------------------------------------------------

const SUBJECT = 'রক্ত লাগবে — A+ রক্তের জরুরি প্রয়োজন, এভারকেয়ার হাসপাতাল, গুলশান'
const TEXT = [
  'শুভ, আপনার কাছে একজনের A+ রক্ত দরকার।',
  'যুক্তাক্ষর পরীক্ষা: ক্ত ক্ষ ঙ্গ জ্ঞ হ্ম',
  'দূরত্ব: ২.২ কিমি',
].join('\n')
const HTML = '<p>শুভ, একজনের <strong>A+</strong> রক্ত দরকার।</p><p>ক্ত ক্ষ ঙ্গ জ্ঞ</p>'

const raw = build({
  fromName: SENDER,
  fromAddress: ADDRESS,
  to: 'donor@example.com',
  subject: SUBJECT,
  text: TEXT,
  html: HTML,
  date: new Date(Date.UTC(2026, 7, 13, 5, 30, 0)),
  messageId: '<test@roktolagbe>',
})

const headerBlock = raw.split('\r\n\r\n')[0]
const headerLines = headerBlock.split('\r\n')

// Fault 3. This is the one that destroyed every message.
ok('no blank line inside the header block', !headerLines.some((l) => l.trim() === ''))
ok('every header line is US-ASCII', !headerLines.some((l) => /[^\x00-\x7F]/.test(l)))
ok('exactly one From header', headerLines.filter((l) => l.startsWith('From:')).length === 1)
ok('no header line over the RFC 5322 limit of 998', !headerLines.some((l) => l.length > 998))
ok(
  'every continuation line begins with a space and carries content',
  headerLines.every((l, i) => i === 0 || /^[\x21-\x7E]+:/.test(l) || (l.startsWith(' ') && l.trim())),
)
ok('CRLF throughout, no bare LF', !/[^\r]\n/.test(raw))
// Fault 2.
ok('the From header is not encoded twice', !/=\?utf-8\?Q\?=3d/i.test(raw))

console.log('\n  --- the header block, as it goes on the wire ---')
console.log(headerLines.map((l) => '    ' + l).join('\n'))

// ---------------------------------------------------------------------------
console.log('\nWhat an independent parser reads back\n')
// ---------------------------------------------------------------------------

const parsed = await simpleParser(raw)
ok('subject decodes to the original Bangla', parsed.subject === SUBJECT, `\n        got: ${parsed.subject}`)
ok('display name decodes to Bangla', parsed.from?.value?.[0]?.name === SENDER)
ok('address is the dotless one', parsed.from?.value?.[0]?.address === ADDRESS)
ok('recipient survived', parsed.to?.value?.[0]?.address === 'donor@example.com')
ok('date parsed', parsed.date instanceof Date && !Number.isNaN(+parsed.date))
ok('text part decodes to the original', parsed.text?.trim() === TEXT.trim())
ok('html part decodes to the original', parsed.html === HTML)
ok('conjuncts intact', parsed.text.includes('ক্ত ক্ষ ঙ্গ জ্ঞ হ্ম'))
// Fault 1. If any of these appear in the body, the header block ended early.
ok('no headers leaked into the body', !/MIME-Version|Content-Type:|^Date:/m.test(parsed.text))
ok('no quoted-printable escapes visible', !/=E0=A6/i.test(parsed.text))
ok('no raw encoded-word visible in the subject', !parsed.subject.includes('=?utf-8?'))

// ---------------------------------------------------------------------------
console.log('\nSubjects that break encoders\n')
// ---------------------------------------------------------------------------

for (const [label, subject] of [
  ['long enough to fold many times', 'রক্ত লাগবে '.repeat(30)],
  ['pure ASCII', 'Blood needed at Evercare Hospital'],
  ['mixed script', 'A+ রক্ত needed — Evercare, গুলশান-১'],
  ['emoji, which is four bytes', '🩸 রক্ত লাগবে 🩸'],
  ['a single character', 'ক'],
]) {
  const m = build({
    fromName: SENDER, fromAddress: ADDRESS, to: 'd@example.com',
    subject, text: 'x', html: '<p>x</p>',
    date: new Date(Date.UTC(2026, 7, 13)), messageId: '<x@y>',
  })
  const p = await simpleParser(m)
  ok(`${label}: no blank header line`, !m.split('\r\n\r\n')[0].split('\r\n').some((l) => !l.trim()))
  // trim(): leading and trailing whitespace in a header value cannot survive
  // unfolding, so encodeWords drops it deliberately.
  ok(`${label}: round trips`, p.subject === subject.trim(), `\n        got: ${JSON.stringify(p.subject)}`)
}

// A space that lands exactly on a chunk boundary is the one at risk: RFC 2047
// decoders delete whitespace BETWEEN adjacent encoded-words. Sweeping every
// length either side of the boundary guarantees some of these land on it.
let boundaryLost = 0
for (let pad = 1; pad <= 40; pad++) {
  const subject = 'র'.repeat(pad) + ' ' + 'ক'.repeat(40)
  const p = await simpleParser(build({
    fromName: 'x', fromAddress: ADDRESS, to: 'd@example.com', subject,
    text: 'x', html: '<p>x</p>', date: new Date(Date.UTC(2026, 7, 13)), messageId: '<x@y>',
  }))
  if (p.subject !== subject) boundaryLost++
}
ok('a space on a chunk boundary is never swallowed', boundaryLost === 0,
   `\n        ${boundaryLost} of 40 lengths lost the space`)

ok('dot-stuffing doubles a leading dot', dotStuff('a\r\n.b\r\nc') === 'a\r\n..b\r\nc')
ok('dot-stuffing leaves everything else alone', dotStuff('a\r\nb') === 'a\r\nb')

// ---------------------------------------------------------------------------
console.log('\nA real SMTP conversation\n')
// ---------------------------------------------------------------------------

const CREDS = { user: ADDRESS, pass: 'sixteen char app' }
const REFUSED = 'refused@example.com'

/** A server that answers the way Gmail does, including the awkward parts. */
function fakeSmtp() {
  const received = []
  const transcript = []

  const server = net.createServer((socket) => {
    let buffer = ''
    let inData = false
    let expect = null
    let user = null
    let envelope = { from: null, to: [], data: '' }

    const say = (line) => {
      transcript.push('S: ' + line)
      socket.write(line + '\r\n')
    }
    say('220 fake.smtp.test ESMTP ready')

    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1')
      for (;;) {
        const nl = buffer.indexOf('\r\n')
        if (nl < 0) break
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 2)

        if (inData) {
          if (line === '.') {
            // Un-dot-stuff, as any real receiver must.
            const message = envelope.data
              .split('\r\n')
              .map((l) => (l.startsWith('..') ? l.slice(1) : l))
              .join('\r\n')
            received.push({ from: envelope.from, to: [...envelope.to], message })
            envelope = { from: null, to: [], data: '' }
            inData = false
            say('250 2.0.0 OK queued')
          } else {
            envelope.data += (envelope.data ? '\r\n' : '') + line
          }
          continue
        }

        transcript.push('C: ' + (expect === 'pass' ? '<base64 password>' : line))

        if (expect === 'user') {
          user = Buffer.from(line, 'base64').toString('utf8')
          expect = 'pass'
          say('334 UGFzc3dvcmQ6')
          continue
        }
        if (expect === 'pass') {
          const pass = Buffer.from(line, 'base64').toString('utf8')
          expect = null
          say(user === CREDS.user && pass === CREDS.pass
            ? '235 2.7.0 Accepted'
            : '535 5.7.8 Username and Password not accepted')
          continue
        }

        const [verb, ...rest] = line.split(' ')
        const arg = rest.join(' ')
        switch (verb.toUpperCase()) {
          case 'EHLO':
            // Multi-line on purpose. A client that stops reading at the first
            // line reads every later reply one command out of step.
            say('250-fake.smtp.test at your service')
            say('250-SIZE 35882577')
            say('250-8BITMIME')
            say('250-AUTH LOGIN PLAIN')
            say('250 SMTPUTF8')
            break
          case 'AUTH':
            if (arg.toUpperCase().startsWith('LOGIN')) { expect = 'user'; say('334 VXNlcm5hbWU6') }
            else say('504 5.5.4 Unrecognized authentication type')
            break
          case 'MAIL':
            envelope.from = /<(.*)>/.exec(arg)?.[1] ?? null
            say('250 2.1.0 OK')
            break
          case 'RCPT': {
            const to = /<(.*)>/.exec(arg)?.[1] ?? ''
            if (to === REFUSED) say('550 5.1.1 No such user here')
            else { envelope.to.push(to); say('250 2.1.5 OK') }
            break
          }
          case 'DATA': inData = true; say('354 Go ahead'); break
          case 'RSET': envelope = { from: null, to: [], data: '' }; say('250 2.0.0 OK'); break
          case 'QUIT': say('221 2.0.0 Bye'); socket.end(); break
          default: say('500 5.5.1 Unrecognized command')
        }
      }
    })
    socket.on('error', () => {})
  })

  return { server, received, transcript }
}

const { server, received, transcript } = fakeSmtp()
const port = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port))
})

// The client is Deno code. connectTls is the only Deno API it uses, so it is
// the only thing shimmed; the state machine under test is the shipped one.
// Plain TCP here — see the note at the top about why TLS is out of scope.
globalThis.Deno = {
  connectTls: ({ hostname, port }) =>
    new Promise((resolve, reject) => {
      const socket = net.connect({ host: hostname, port }, () =>
        resolve({
          readable: Readable.toWeb(socket),
          writable: Writable.toWeb(socket),
          close: () => socket.destroy(),
        }),
      )
      socket.once('error', reject)
    }),
}

const { SmtpConnection, SmtpError } = await import(path.join(SHARED, 'smtp.ts'))
const options = { hostname: '127.0.0.1', port, username: CREDS.user, password: CREDS.pass }

try {
  await SmtpConnection.connect({ ...options, password: 'the account password' })
  ok('a wrong password is refused', false)
} catch (err) {
  ok('a wrong password is refused', err instanceof SmtpError && err.code === 535)
  ok('the refusal says App Password rather than "not accepted"', /App Password/.test(err.message))
  ok('a 5xx is marked permanent', err.permanent === true)
}

const client = await SmtpConnection.connect(options)
ok('greeting, multi-line EHLO and AUTH LOGIN all succeed', true)

const message = {
  fromName: SENDER, fromAddress: ADDRESS, to: 'donor@example.com',
  subject: SUBJECT, text: TEXT, html: HTML,
}
await client.send(message)
ok('a Bangla message is accepted', received.length === 1)

try {
  await client.send({ ...message, to: REFUSED })
  ok('a refused recipient throws', false)
} catch (err) {
  ok('a refused recipient throws', err instanceof SmtpError && err.code === 550)
  ok('a refused recipient is permanent, so it is not retried', err.permanent === true)
}
await client.reset()
await client.send({ ...message, to: 'second@example.com', subject: 'রক্ত লাগবে '.repeat(30) })
ok('one bad address does not take the rest of the batch down', received.length === 2)

// Fixed date and Message-ID so what the server received can be compared byte
// for byte with what build() produced. That is the only way to prove the DATA
// transfer and the dot-stuffing changed nothing at all.
const exact = {
  ...message,
  to: 'third@example.com',
  date: new Date(Date.UTC(2026, 7, 13, 5, 30, 0)),
  messageId: '<exact@roktolagbe>',
}
await client.send(exact)

await client.close()
server.close()

// ---------------------------------------------------------------------------
console.log('\nWhat the server actually received\n')
// ---------------------------------------------------------------------------

const first = received[0]
ok('envelope sender is the authenticated account', first.from === ADDRESS)
ok('envelope recipient is the donor', first.to.join() === 'donor@example.com')

const delivered = await simpleParser(first.message)
ok('subject arrives as Bangla', delivered.subject === SUBJECT, `\n        got: ${delivered.subject}`)
ok('display name arrives as Bangla', delivered.from?.value?.[0]?.name === SENDER)
ok('address arrives without the dot', delivered.from?.value?.[0]?.address === ADDRESS)
ok('text part arrives intact', delivered.text?.trim() === TEXT.trim())
ok('html part arrives intact', delivered.html === HTML)
ok('exactly one From header on the wire',
   first.message.split('\r\n\r\n')[0].split('\r\n').filter((l) => l.startsWith('From:')).length === 1)
ok('no blank line in the delivered header block',
   !first.message.split('\r\n\r\n')[0].split('\r\n').some((l) => !l.trim()))
// The boundary is a fresh UUID on every build, so the two messages differ
// there and nowhere else. Normalising it is what lets the rest be compared
// exactly — this is the check that the wire changed nothing.
const normalise = (s) => s.replace(/----roktolagbe_[0-9a-f]{32}/g, '----BOUNDARY')
ok('the message arrives byte for byte as it was built',
   normalise(received[2].message) === normalise(build(exact)))

const long = await simpleParser(received[1].message)
ok('a subject folded across seven lines arrives whole',
   long.subject === 'রক্ত লাগবে '.repeat(30).trim(), `\n        got: ${long.subject}`)

console.log('\n  --- the conversation, as far as AUTH ---')
console.log(transcript.slice(0, 13).map((l) => '    ' + l).join('\n'))

console.log(
  bad === 0
    ? '\nAll checks passed. Bangla mail is built and sent correctly.\n'
    : `\n${bad} CHECK${bad === 1 ? '' : 'S'} FAILED — do not deploy.\n`,
)
process.exit(bad ? 1 : 0)
