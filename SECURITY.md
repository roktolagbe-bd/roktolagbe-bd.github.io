# Security and privacy

This project holds real contact details for real people who volunteered to give
blood. If that data leaks, donors get spam calls, scam calls, and worse. This
document says exactly what we collect, who can see it, and how that is
enforced.

Written in plain English on purpose. A donor should be able to read it.

---

## Reporting a problem

**Do not open a public issue for anything that could expose donor data.**

Email **roktolagbe.bd@gmail.com** with what you found and how to reproduce it.
We will reply as fast as we can, fix it, and credit you if you would like to be
credited.

---

## What we collect

### From a donor, when they register

| Data | Why | Ever shown publicly? |
| --- | --- | --- |
| Full name | So we know who you are | **No** |
| Display name | Shown on search results and the donor wall | Yes, first name only by default |
| Blood group | The entire point | Yes |
| Phone number | So a requester can call you | **No.** Only after you accept a request |
| WhatsApp number | Same, optional | **No.** Only after you accept |
| Email address | To tell you a request is nearby | **No** |
| Facebook link | Optional, helps a requester trust you | **No.** Only after you accept |
| District and upazila | So we can find donors near a request | Yes, area name only |
| Street address | Optional, helps with directions after you accept | **No. Never.** |
| Exact location | To rank donors by real distance | **No.** See fuzzing below |
| Date of birth, weight | Eligibility only | **No** |
| Last donation date | So we do not ask you too soon | Only the month, e.g. "2026-03" |
| A hashed form of your IP address | To stop bots and spam | **No** |

### From a requester, when they ask for blood

Name, phone, optional WhatsApp and email, blood group, units, urgency,
hospital, area, when it is needed by, and an optional note about the patient.

Requester contact details are shown **only** to donors who were emailed about
that specific request, and only while the request is open.

### What we never collect

No passwords for public users. No national ID. No payment details. No tracking
pixels, no analytics, no advertising scripts, no third-party fonts. The site
makes no requests to any server other than our own database.

---

## The rules

These are not guidelines. They are enforced in the database.

1. **Donor phone, WhatsApp, email, Facebook link and street address are never
   public.** Not on a page, not in an API response, not in a map popup, not in
   a CSV a stranger can download.

2. **Public search results contain only:** display name, blood group, area,
   rough distance, availability, and the month of the last donation.

3. **The public map never shows a real location.** See below.

4. **Contact details are released once**, when a donor accepts a specific
   request, and only to the person who made that request.

5. **Every email has a one-click opt-out** driven by a token unique to that
   donor. No login, no "are you sure", no talking them out of it.

6. **A donor can be listed without being browsable.** Consent to email and
   consent to public listing are separate. Someone who does not want to appear
   in search can still be reached in an emergency, if they chose that.

---

## How location is protected

Distance ranking needs a real position. Showing that position would tell
strangers where a donor lives. So:

- The true coordinates are stored in `lat` and `lng`. **No public view or
  function ever returns them.** Only an admin can read those columns.
- A separate pair, `lat_fuzzed` and `lng_fuzzed`, is what the public map plots.
  It is the true point rounded to 3 decimals and moved by a random offset of up
  to **800 metres**, in a random direction.
- The offset is generated once, when the position is saved, and stored. It does
  not change on every page load. That matters: a point that jittered could be
  averaged over many requests to recover the true one.
- The offset is spread evenly over the disc rather than clustered in the
  middle, so the true point is not the most likely guess.
- Distances shown to users are computed from the true point and then rounded,
  so the ranking is honest without the position being exposed.

What this means in practice: the map tells you someone with O− is in your part
of town. It does not tell you which building.

---

## How this is enforced

**In Postgres, with Row Level Security. Not in React.**

Checking permissions in the browser is a convenience for the user, not a
protection. Anyone can open the developer console and issue their own queries
with the public key. So the rules live where they cannot be bypassed.

The public API key (`VITE_SUPABASE_ANON_KEY`) is public by design. It appears
in the built site and that is fine. It identifies the anonymous role, and the
anonymous role can do exactly three things:

- `INSERT` into `donors` — register
- `INSERT` into `blood_requests` — ask for blood
- `SELECT` from a small set of views that contain no contact columns

There is **no** `SELECT` policy on the `donors` table for anonymous users. With
Row Level Security on and no policy, the table is closed: `select * from donors`
returns zero rows however the query is written.

Everything else goes through functions that check a token or an admin
allowlist, and return only the fields the caller is entitled to. The full set of
rules is in
[`supabase/migrations/0009_rls_policies.sql`](supabase/migrations/0009_rls_policies.sql),
in one file, with comments.

The `service_role` key bypasses all of this. It lives only in Supabase Edge
Function secrets. It is never in this repository, never in a `VITE_` variable,
and never reachable from a browser.

### Check it yourself

With the site's own public key, from any browser console:

```js
await supabase.from('donors').select('phone')      // → no rows
await supabase.from('donors').select('*')          // → no rows
await supabase.from('donors_public').select('*')   // → rows, but no contact columns
```

If any of those returns a phone number, that is a serious bug. Email us.

---

## Admin access

The admin panel is at `/admin` and needs a Supabase login **and** a row in the
`admins` allowlist. A valid session that is not on the allowlist is rejected.

Admins can see contact details, because verifying and unblocking donors
requires it. Every action an admin takes on someone else's data is written to
`audit_log`, and **nobody can edit or delete that log, including admins**.
There is no `UPDATE` or `DELETE` policy on it, deliberately.

---

## Abuse controls, without a paid captcha

- **Rate limiting** on registrations and requests: three per connection per
  hour, enforced by a database trigger, not by the browser.
- **IP addresses are never stored.** They are salted and hashed server-side
  before they reach the database, so this table cannot be used to work out who
  was looking for blood.
- **A honeypot field** that humans never see and never fill.
- **A time-on-page check**, because a form completed in under four seconds was
  not completed by a person.

No third-party captcha, so no third party learns who visits this site.

---

## Data retention

- Blood requests expire automatically six hours after the time they were needed
  by. Once a request is closed, its response tokens stop working, so an old
  email cannot be replayed later to fish for contact details.
- A donor who opts out has both consents switched off immediately and is never
  emailed or listed again.
- Deleting a donor record entirely: email us and we will do it. We are working
  on making this self-service.

---

## Known limits

Being straight about what this design does not do:

- **Admins can see everything.** The protection there is the allowlist and the
  audit log, not the database. Choose admins carefully.
- **Fuzzing is a defence, not a guarantee.** An 800 metre offset protects an
  address in a city. In a sparsely populated area, a single donor plus a small
  village narrows things down. If you are the only O− donor in your upazila,
  consider not consenting to public listing; you can still be emailed.
- **Email is not encrypted end to end.** An acceptance email contains a phone
  number and travels over ordinary email.
- **We cannot stop a requester misusing a number** once a donor accepts. That
  is a person-to-person interaction. Report anyone who does it and we will
  block them.

---

## Licence

Code is MIT. Geographic seed data is ODbL, derived from OpenStreetMap; see
[`supabase/seed/README.md`](supabase/seed/README.md).
