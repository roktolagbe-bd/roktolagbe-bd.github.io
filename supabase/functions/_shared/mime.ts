/**
 * Building the mail message ourselves.
 *
 * denomailer cannot do it. The saved .eml showed two independent faults:
 *
 *   It Q-encodes the From header, so an RFC 2047 word passed in gets encoded a
 *   second time and arrives as =?utf-8?Q?=3d?utf-8?B?...=3d=3d?=3d?=.
 *
 *   It folds a long Q-encoded Subject by emitting a soft line break that
 *   leaves a BLANK LINE inside the header block. A blank line is exactly how
 *   RFC 5322 says headers end, so From, To, Date, MIME-Version and
 *   Content-Type all became body text.
 *
 * The second is not something the caller can work around. Any Bangla subject
 * is long once encoded, so it always folds, so it always breaks. Encoding more
 * carefully on our side cannot help; the library is the thing that is wrong.
 *
 * So this module produces the complete RFC 5322 message and the SMTP client
 * next door writes it verbatim. Two rules run through all of it:
 *
 *   1. Every header line is US-ASCII. Non-ASCII goes through an RFC 2047
 *      encoded-word, once.
 *   2. No line inside the header block is ever empty. Continuation lines start
 *      with a space and always carry content. There is an assertion at the end
 *      of build() that checks this on the finished message, because this is
 *      the failure that shipped.
 *
 * Bodies are base64 rather than quoted-printable. Base64 has fixed-width lines
 * with no soft breaks to get wrong, cannot produce a line starting with a dot,
 * and for Bangla is shorter than quoted-printable anyway.
 */

const CRLF = '\r\n'

/** RFC 5322 says 78 characters is the limit to aim for, 998 the hard maximum. */
const LINE_TARGET = 78

/**
 * Text as an RFC 2047 encoded-word, or unchanged when it is already ASCII.
 *
 * Base64 rather than Q: in Bangla nearly every byte needs escaping, so
 * Q-encoding runs about three times longer and hits the length limit sooner.
 *
 * Returns an ARRAY of words. The caller decides how to lay them out, which is
 * what makes correct folding possible: each word goes on its own line, and a
 * line holding a word can never be empty.
 */
export function encodeWords(text: string): string[] {
  // CR and LF in a header value end the header block early, and are also how
  // header injection works. Neither may survive.
  const clean = text.replace(/[\r\n]+/g, ' ').trim()
  if (!clean) return []

  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(clean)) return [clean]

  const PREFIX = '=?utf-8?B?'
  const SUFFIX = '?='
  // 75 is the RFC 2047 maximum for a whole encoded-word, wrapper included.
  const budget = 75 - PREFIX.length - SUFFIX.length

  const encoder = new TextEncoder()
  const words: string[] = []
  let chunk = ''

  // Iterating the string yields whole code points, so a character can never be
  // split across two words and arrive as a replacement character.
  for (const char of clean) {
    const candidate = chunk + char
    const encodedLength = Math.ceil(encoder.encode(candidate).length / 3) * 4
    if (encodedLength > budget && chunk) {
      words.push(PREFIX + base64(chunk) + SUFFIX)
      chunk = char
    } else {
      chunk = candidate
    }
  }
  if (chunk) words.push(PREFIX + base64(chunk) + SUFFIX)
  return words
}

/**
 * A complete header line, folded so that no line is empty and none is over-long.
 *
 * Folding is done by putting each piece on its own continuation line beginning
 * with a single space. Pieces are never empty, so a folded line is never
 * empty, which is the entire bug this replaces.
 */
export function foldHeader(name: string, pieces: string[]): string {
  const safeName = name.replace(/[^\x21-\x39\x3B-\x7E]/g, '')
  if (pieces.length === 0) return ''

  const lines: string[] = []
  let current = `${safeName}:`

  for (const piece of pieces) {
    if (current.length + 1 + piece.length <= LINE_TARGET) {
      current += ' ' + piece
    } else {
      lines.push(current)
      current = ' ' + piece
    }
  }
  lines.push(current)
  return lines.join(CRLF)
}

/** One header whose value needs no splitting, such as an address or a date. */
function plainHeader(name: string, value: string): string {
  return foldHeader(name, [value.replace(/[\r\n]+/g, ' ').trim()])
}

function base64(text: string): string {
  return base64Bytes(new TextEncoder().encode(text))
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Base64 wrapped at 76 characters, which is what RFC 2045 asks for. */
function base64Body(text: string): string {
  const encoded = base64(text)
  const lines: string[] = []
  for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76))
  return lines.join(CRLF)
}

/**
 * An address for a From or To header.
 *
 * The display name is encoded once, here, and nowhere else. The address itself
 * is never encoded: an addr-spec has to be ASCII, and if it is not then no
 * encoding rescues it.
 */
export function addressHeader(name: string, address: string): string[] {
  const clean = address.replace(/[\r\n<>,;]/g, '').trim()
  const words = encodeWords(name)
  if (words.length === 0) return [clean]
  return [...words, `<${clean}>`]
}

export type Message = {
  fromName: string
  fromAddress: string
  to: string
  subject: string
  text: string
  html: string
  /** Injectable so tests are deterministic. */
  date?: Date
  messageId?: string
}

/**
 * The finished message, ready to be written after DATA.
 *
 * multipart/alternative with the plain text part first, because a client that
 * shows only one part is supposed to show the last one it understands, and
 * plenty of mail apps here fall back to text.
 */
export function build(message: Message): string {
  const date = message.date ?? new Date()
  const domain = message.fromAddress.split('@')[1] ?? 'roktolagbe'
  const messageId =
    message.messageId ?? `<${crypto.randomUUID()}@${domain.replace(/[^\w.-]/g, '')}>`

  // A boundary that cannot appear in base64 output, which uses only
  // A-Z a-z 0-9 + / =.
  const boundary = `----roktolagbe_${crypto.randomUUID().replace(/-/g, '')}`

  const headers = [
    foldHeader('From', addressHeader(message.fromName, message.fromAddress)),
    plainHeader('To', message.to.replace(/[<>]/g, '')),
    foldHeader('Subject', encodeWords(message.subject)),
    plainHeader('Date', rfc5322Date(date)),
    plainHeader('Message-ID', messageId),
    plainHeader('MIME-Version', '1.0'),
    plainHeader('Content-Type', `multipart/alternative; boundary="${boundary}"`),
  ].filter(Boolean)

  const body = [
    `--${boundary}`,
    plainHeader('Content-Type', 'text/plain; charset=utf-8'),
    plainHeader('Content-Transfer-Encoding', 'base64'),
    '',
    base64Body(message.text),
    '',
    `--${boundary}`,
    plainHeader('Content-Type', 'text/html; charset=utf-8'),
    plainHeader('Content-Transfer-Encoding', 'base64'),
    '',
    base64Body(message.html),
    '',
    `--${boundary}--`,
  ].join(CRLF)

  const raw = headers.join(CRLF) + CRLF + CRLF + body

  assertHeaderBlockIntact(raw)
  return raw
}

/**
 * The check that would have caught what shipped.
 *
 * Walks the finished message and refuses to hand back anything where the
 * header block ends before the headers do, or where a header line is not
 * ASCII. Throwing here means one message fails loudly instead of every message
 * arriving unreadable.
 */
function assertHeaderBlockIntact(raw: string): void {
  const [headerPart] = raw.split(CRLF + CRLF, 1)
  if (!headerPart) throw new Error('mime: message has no header block')

  const lines = headerPart.split(CRLF)
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') {
      throw new Error(
        `mime: blank line at header ${index + 1} would end the header block early. ` +
          'This is the denomailer folding bug and it must never come back.',
      )
    }
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7F]/.test(line)) {
      throw new Error(`mime: non-ASCII in header line ${index + 1}: ${line.slice(0, 40)}`)
    }
    if (line.length > 998) {
      throw new Error(`mime: header line ${index + 1} exceeds the RFC 5322 limit of 998`)
    }
  }

  // Every header this project depends on must be a real header, not body text.
  for (const required of ['From:', 'To:', 'Subject:', 'MIME-Version:', 'Content-Type:']) {
    if (!lines.some((line) => line.startsWith(required))) {
      throw new Error(`mime: ${required} is missing from the header block`)
    }
  }

  // Exactly one From. Two is invalid and hurts deliverability.
  const fromCount = lines.filter((line) => line.startsWith('From:')).length
  if (fromCount !== 1) throw new Error(`mime: ${fromCount} From headers, expected exactly 1`)
}

/** Date in the format RFC 5322 wants, in UTC so there is no locale in it. */
function rfc5322Date(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    `${days[date.getUTCDay()]}, ${date.getUTCDate()} ${months[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} +0000`
  )
}

/**
 * Dot-stuffing, per RFC 5321.
 *
 * A line consisting of a single dot ends the DATA command, so any line that
 * begins with one gets a second. Base64 cannot produce a leading dot and the
 * headers are all ASCII, so this should never fire — which is exactly why it
 * is here rather than assumed.
 */
export function dotStuff(raw: string): string {
  return raw
    .split(CRLF)
    .map((line) => (line.startsWith('.') ? '.' + line : line))
    .join(CRLF)
}
