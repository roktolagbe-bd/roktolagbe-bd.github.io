/**
 * A small SMTP client, speaking to Gmail over implicit TLS on port 465.
 *
 * This exists because denomailer builds the message, and the message it built
 * was broken in two independent ways (see mime.ts). There is no setting that
 * turns that off: the library owns the header block. So the header block is
 * built next door and this writes it to the socket unaltered.
 *
 * It is deliberately small. It does exactly what sending mail through Gmail
 * needs — implicit TLS, AUTH LOGIN, one envelope per message, DATA — and
 * nothing else. No STARTTLS, no PLAIN, no XOAUTH2, no pipelining, no 8BITMIME:
 * the message is ASCII on the wire because the bodies are base64.
 *
 * Two things it does that a toy client would not:
 *
 *   Every read has a timeout. A socket that stops answering must fail the
 *   drain, not hang the Edge Function until the platform kills it, because a
 *   killed invocation leaves rows marked 'queued' with no attempt recorded and
 *   the queue silently stops moving.
 *
 *   Failures carry the SMTP reply code. 5xx is permanent — a wrong address is
 *   still wrong in twenty minutes — and retrying it three times only spends
 *   the daily quota and teaches Gmail that this sender retries bad addresses.
 */

import { build, dotStuff, type Message } from './mime.ts'

const CRLF = '\r\n'

/** Long enough for Gmail on a bad day; short enough to fail inside one invocation. */
const READ_TIMEOUT_MS = 30_000

export class SmtpError extends Error {
  /** The three-digit reply code, or 0 when the connection failed before one arrived. */
  readonly code: number
  /** 4xx and connection trouble are worth another attempt; 5xx is not. */
  readonly permanent: boolean

  constructor(message: string, code: number) {
    super(message)
    this.name = 'SmtpError'
    this.code = code
    this.permanent = code >= 500 && code < 600
  }
}

export type SmtpOptions = {
  hostname: string
  port: number
  username: string
  password: string
}

export class SmtpConnection {
  #conn: Deno.TlsConn | null = null
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  #buffer = ''
  readonly #options: SmtpOptions

  private constructor(options: SmtpOptions) {
    this.#options = options
  }

  /** Connects, greets and authenticates. Throws if any of that fails. */
  static async connect(options: SmtpOptions): Promise<SmtpConnection> {
    const client = new SmtpConnection(options)
    await client.#open()
    return client
  }

  async #open(): Promise<void> {
    const conn = await Deno.connectTls({
      hostname: this.#options.hostname,
      port: this.#options.port,
    })
    this.#conn = conn
    this.#reader = conn.readable.getReader()

    // The server speaks first.
    await this.#expect(220)

    // The EHLO argument should be a name for this client. There is no resolvable
    // hostname for an Edge Function, so a bracketed literal is the honest form.
    await this.#command(`EHLO [127.0.0.1]`, 250)

    // AUTH LOGIN rather than PLAIN: Gmail accepts both, and LOGIN keeps the
    // password in its own line rather than concatenated with the username,
    // which makes a mis-encoded credential obvious in a 535 instead of silent.
    await this.#command('AUTH LOGIN', 334)
    await this.#command(base64(this.#options.username), 334)
    try {
      await this.#command(base64(this.#options.password), 235)
    } catch (err) {
      // Rewritten because the raw reply is "Username and Password not accepted",
      // which sends everyone to reset the password when the actual cause is
      // almost always an ordinary password used where an App Password is needed.
      const code = err instanceof SmtpError ? err.code : 0
      throw new SmtpError(
        `SMTP authentication was refused (${code}). GMAIL_APP_PASSWORD must be a ` +
          '16-character Google App Password, not the account password, and 2-Step ' +
          'Verification has to be on for the account to issue one.',
        code,
      )
    }
  }

  /**
   * One message: envelope, DATA, and the raw text of the message itself.
   *
   * `message` is everything mime.ts needs; the built text is what goes on the
   * wire, dot-stuffed, with nothing added to it here.
   */
  async send(message: Message): Promise<void> {
    const raw = build(message)

    // The envelope sender is the authenticated account. It is not the From
    // header and does not have to match it, but with Gmail it always will —
    // Gmail rewrites the envelope to the authenticated user regardless.
    await this.#command(`MAIL FROM:<${envelope(message.fromAddress)}>`, 250)
    await this.#command(`RCPT TO:<${envelope(message.to)}>`, [250, 251])
    await this.#command('DATA', 354)

    // The terminator is CRLF "." CRLF, so the message must not already end in
    // a newline or the dot lands on a line of its own too early.
    await this.#write(dotStuff(raw.replace(/\r?\n+$/, '')) + CRLF + '.' + CRLF)
    await this.#expect(250)
  }

  /**
   * Forgets any half-finished transaction.
   *
   * Called between messages when one fails, so a refused recipient does not
   * leave the session in a state where the next MAIL FROM is rejected too and
   * one bad address takes the whole batch down with it.
   */
  async reset(): Promise<void> {
    await this.#command('RSET', 250)
  }

  /** QUIT and close. Safe to call more than once, and never throws. */
  async close(): Promise<void> {
    if (!this.#conn) return
    try {
      await this.#write(`QUIT${CRLF}`)
      await this.#readReply()
    } catch {
      // A server that has already gone away is not a problem at this point.
    }
    try {
      this.#reader?.releaseLock()
      this.#conn.close()
    } catch {
      // Same.
    }
    this.#conn = null
    this.#reader = null
  }

  // ---- the wire ----------------------------------------------------------

  async #command(line: string, expected: number | number[]): Promise<string> {
    await this.#write(line + CRLF)
    return await this.#expect(expected)
  }

  async #write(text: string): Promise<void> {
    const conn = this.#conn
    if (!conn) throw new SmtpError('SMTP connection is closed', 0)
    const bytes = new TextEncoder().encode(text)
    const writer = conn.writable.getWriter()
    try {
      await writer.write(bytes)
    } finally {
      writer.releaseLock()
    }
  }

  async #expect(expected: number | number[]): Promise<string> {
    const codes = Array.isArray(expected) ? expected : [expected]
    const reply = await this.#readReply()
    if (!codes.includes(reply.code)) {
      throw new SmtpError(
        `SMTP expected ${codes.join(' or ')} but got ${reply.code}: ${reply.text}`,
        reply.code,
      )
    }
    return reply.text
  }

  /**
   * One complete reply, which may span several lines.
   *
   * A multi-line reply repeats the code with a hyphen — "250-SIZE" — and the
   * last line uses a space. Stopping at the first line would leave the rest of
   * the EHLO response in the buffer and every later reply would be read one
   * command out of step.
   */
  async #readReply(): Promise<{ code: number; text: string }> {
    const lines: string[] = []

    for (;;) {
      const line = await this.#readLine()
      lines.push(line)

      // "250 text" ends the reply; "250-text" continues it.
      const final = /^(\d{3})(?: (.*))?$/.exec(line)
      if (final) {
        const code = Number(final[1])
        const text = lines
          .map((l) => l.slice(4).trim())
          .filter(Boolean)
          .join('; ')
        return { code, text }
      }

      if (!/^\d{3}-/.test(line)) {
        throw new SmtpError(`SMTP sent a line that is not a reply: ${line.slice(0, 120)}`, 0)
      }
    }
  }

  async #readLine(): Promise<string> {
    for (;;) {
      const newline = this.#buffer.indexOf(CRLF)
      if (newline >= 0) {
        const line = this.#buffer.slice(0, newline)
        this.#buffer = this.#buffer.slice(newline + CRLF.length)
        return line
      }

      const reader = this.#reader
      if (!reader) throw new SmtpError('SMTP connection is closed', 0)

      const result = await withTimeout(reader.read(), READ_TIMEOUT_MS)
      if (result.done) {
        throw new SmtpError('SMTP server closed the connection unexpectedly', 0)
      }
      // Latin-1 rather than UTF-8: replies are ASCII by definition, and
      // decoding byte by byte means a chunk boundary can never fall inside a
      // multi-byte sequence and produce a replacement character.
      this.#buffer += latin1(result.value)
    }
  }
}

/** Rejects rather than waiting forever. A hung read must not eat the invocation. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new SmtpError(`SMTP read timed out after ${ms}ms`, 0)),
      ms,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * An address stripped of everything that is not part of an addr-spec.
 *
 * A CRLF here would let a queued address inject SMTP commands — an extra
 * RCPT TO would silently copy someone else on a donor's request email. The
 * address column is written by our own code, but this is the one place where
 * being wrong about that is unrecoverable.
 */
function envelope(address: string): string {
  return address.replace(/[\r\n<>,;\s]/g, '').trim()
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function latin1(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return out
}
