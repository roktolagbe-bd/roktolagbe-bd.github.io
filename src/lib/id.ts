/**
 * A UUID chosen by the browser, before the row exists.
 *
 * This is here because of how the privacy rules interact with PostgREST.
 * Anonymous visitors may INSERT into donors and blood_requests and may not
 * SELECT from either, which is the whole point: `select * from donors` has to
 * return nothing no matter how the query is written.
 *
 * But `.insert(...).select('id')` asks Postgres for `INSERT ... RETURNING`,
 * and RETURNING is a read. With no SELECT policy to satisfy, the statement
 * fails with "new row violates row-level security policy" and the entire
 * insert rolls back. The row is never written, and the visitor is told to try
 * again later.
 *
 * Generating the id up front removes the question. Nothing is read back,
 * because nothing needs to be: we already know what the id is.
 */
export function newId(): string {
  // Available in every browser this site supports, but only in a secure
  // context. The site is HTTPS-only, so this is the normal path.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  // Fallback for an insecure context, where randomUUID is undefined but
  // getRandomValues is not. Same RFC 4122 version 4 layout, assembled by hand.
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
