# রক্ত লাগবে — Roktolagbe

Find a blood donor near you in Bangladesh. Free, open source, and run by nobody
in particular.

**Live site:** https://roktolagbe-bd.github.io

`রক্ত লাগবে` is the phrase people type into Facebook when someone they love
needs blood tonight. This site tries to answer that in under thirty seconds:
pick a blood group, see donors near you, send one request that emails the
closest people who can help.

This README is written in simple English on purpose. Volunteers of all skill
levels should be able to follow it.

---

## What you need

| Thing | Cost | Why |
| --- | --- | --- |
| [Node.js](https://nodejs.org) version 22 or newer | Free | To build the site |
| A GitHub account | Free | To host the site |
| A Supabase account | Free tier | Database, login and email functions |
| A Gmail account | Free | To send donor emails (added in a later phase) |

Nothing here costs money. If a step ever asks for a credit card, stop and open
an issue, because you are on the wrong page.

---

## 1. Run it on your own computer

```bash
git clone https://github.com/roktolagbe-bd/roktolagbe-bd.github.io.git
cd roktolagbe-bd.github.io
npm install
npm run dev
```

Open the address it prints, usually http://localhost:5173.

The site works with no database. It shows an honest banner saying it is not
connected and renders empty counters. That is expected.

Useful commands:

```bash
npm run dev      # start the development server
npm run build    # type check, build into dist/, and write dist/404.html
npm run preview  # serve the built site exactly as GitHub Pages will
npx tsc -b       # type check only
```

---

## 2. Connect it to Supabase

1. Go to https://supabase.com and create a free account.
2. Click **New project**. Pick any name. Choose the region closest to
   Bangladesh, which is usually **Singapore**. Save the database password
   somewhere safe.
3. Wait for the project to finish setting up. This takes a couple of minutes.
4. In the left sidebar open **Project Settings**, then **API**.
5. Copy two values:
   - **Project URL**, which looks like `https://abcdefgh.supabase.co`
   - **anon public** key, a long string starting with `eyJ`
6. In the project folder, copy the example file and fill it in:

   ```bash
   cp .env.example .env.local
   ```

   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

7. Stop the dev server and start it again. The "not connected" banner goes away.

### 2b. Create the database

The whole database lives in this repository. Pick whichever way suits you.
Both produce exactly the same result.

**Option A, with the Supabase CLI.** This is the right way if you can install
things. It applies every migration in order and keeps track of which have run.

```bash
npm i -g supabase          # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push           # creates every table, view, function and policy
```

Then load the geography and settings:

```bash
supabase db push --include-seed
# or, if you prefer:  psql "$DATABASE_URL" -f supabase/seed.sql
```

**Option B, paste into the browser.** No installation needed. In the Supabase
dashboard open **SQL Editor** and run these two files, in this order:

```
supabase/setup.sql     everything: tables, views, functions, security rules
supabase/seed.sql      64 districts, 494 upazilas, 42 hospitals, settings
```

Both are safe to run more than once. `setup.sql` runs in a single transaction,
so either the whole database is created or none of it is.

> `supabase/setup.sql` and `supabase/seed.sql` are **generated** from the files
> in `supabase/migrations` and `supabase/seed`. Change a migration, then run
> `node scripts/build-setup-sql.mjs` to rebuild them. Never edit the generated
> files directly, and never change the database by hand in the dashboard: if a
> change is not in a migration, the next person to set this up will not have it.

`supabase/optional/cron_schedule.sql` is not part of the migrations. It is only
needed once email sending is on, and it has placeholders you must fill in
first. See section 3d.

**Check that the privacy rules took.** In the SQL editor:

```sql
-- Must return zero rows: every table has Row Level Security on.
select tablename from pg_tables t
where schemaname = 'public'
  and not exists (
    select 1 from pg_class c where c.relname = t.tablename and c.relrowsecurity
  );
```

Then, from the browser console on your running site, with the public key:

```js
await supabase.from('donors').select('phone')   // must return no rows
```

If that ever returns a phone number, stop and open an issue. That is the one
thing this project cannot get wrong. See [SECURITY.md](SECURITY.md).

### 2c. Make yourself an admin

Register a user first: Supabase dashboard → **Authentication** → **Users** →
**Add user**. Then add that user to the allowlist:

```sql
insert into public.admins (user_id, email, full_name)
select id, email, 'Your Name' from auth.users where email = 'you@example.com';
```

A Supabase login alone does not open the admin panel. The allowlist row is what
does.

> **Is it safe to share the anon key?** Yes. It is designed to be public and it
> ends up inside the built site either way. What protects donor phone numbers is
> Row Level Security inside Postgres, not secrecy of this key. The key you must
> never share is the **service_role** key. It bypasses every rule. It belongs
> only in Supabase Edge Function secrets, never in this repository and never in
> a `VITE_` variable.

---

## 3. Turn on email

Everything above works without this. Do this when you are ready for donors to
actually be told about requests.

### 3a. Make a Gmail App Password

An App Password is a 16 character key that lets one program send mail as your
account, without giving it your real password. You can revoke it any time.

1. Sign in to **roktolagbebd@gmail.com**.
2. Turn on 2-Step Verification: https://myaccount.google.com/signinoptions/two-step-verification
   App Passwords do not exist until you do.
3. Go to https://myaccount.google.com/apppasswords
4. Type a name, for example `Roktolagbe`, and press **Create**.
5. Copy the 16 characters. Google shows it once. Spaces do not matter.

### 3b. Give the secrets to Supabase

In the Supabase dashboard: **Project Settings** → **Edge Functions** → **Secrets**.

| Name | Value |
| --- | --- |
| `GMAIL_USER` | `roktolagbebd@gmail.com` |
| `GMAIL_APP_PASSWORD` | the 16 characters from step 3a |
| `IP_SALT` | a long random string you generate yourself — see 3f |
| `DRAIN_SECRET` | another one, shared with the GitHub secret — see 3d |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

**Never put these in this repository, in a `VITE_` variable, or in a GitHub
secret used by the site build.** The App Password can send mail as you. The
service_role key bypasses every privacy rule in the database.

### 3c. Deploy the functions

`.github/workflows/deploy-functions.yml` does this on every push to `main`
that touches `supabase/functions/`. Give it two repository secrets under
**Settings** → **Secrets and variables** → **Actions** and you never have to
think about it again:

| Name | Where the value comes from |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens → Generate new token. Account-level, shown once. |
| `SUPABASE_PROJECT_REF` | Project Settings → General → Reference ID. Same as the subdomain in `https://<ref>.supabase.co`. |

Neither the Gmail App Password nor the service_role key goes in a GitHub
secret. Those are Edge Function secrets, set in the Supabase dashboard where
only the running function can read them.

To deploy by hand instead, install the Supabase CLI
(https://supabase.com/docs/guides/cli) and run:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy          # all of them
```

> **Deploy `geocode` even if you never turn email on.** It is what turns
> coordinates into a real place name, and it is the only thing that gets
> central Dhaka right. Without it, someone in Gulshan is told they are in
> Keraniganj's district rather than their neighbourhood: not wrong, just
> vaguer. It needs no secrets and no Gmail.

> **The workflow deploys functions, not migrations.** A function that calls a
> new RPC will fail until that migration is run in the SQL editor. Migrations
> stay manual on purpose: applying schema changes to a live database from CI,
> unattended, is a good way to lose data on the day a migration is wrong.

### 3d. Drain the queue on a schedule

Nothing sends by itself. Something has to empty `email_queue`.

**This project uses GitHub Actions.** `.github/workflows/drain-queue.yml` is
enabled and runs every five minutes. It needs two repository secrets under
**Settings** → **Secrets and variables** → **Actions**:

| Name | Where the value comes from |
| --- | --- |
| `SUPABASE_PROJECT_REF` | Project Settings → General → Reference ID |
| `DRAIN_SECRET` | You generate it: `openssl rand -base64 32` |

`DRAIN_SECRET` goes in **two** places with the same value: the GitHub secret
above, and Supabase → **Project Settings** → **Edge Functions** → **Secrets**.
The function rejects any call that does not present it.

> **No database key goes in a GitHub secret.** A repository secret is readable
> by every workflow in the repository and by anyone who can push one, and the
> service_role key bypasses every privacy rule in the database. Giving a cron
> job the ability to read every donor's phone number, so that it can ask for a
> queue to be emptied, is not a trade worth making. `DRAIN_SECRET` proves one
> thing — that the caller may ask for a drain. It opens no tables. If it leaks,
> the worst anyone can do is cause the queue to be sent, which is its purpose,
> and rotating it means changing one string in two places with no redeploy.
>
> This also sidesteps Supabase's new API key format, where a legacy
> `service_role` key may not exist at all.

Two things about GitHub's scheduler, neither of which this workflow can change:
runs are delayed under load, so ten to fifteen minutes late is normal; and
GitHub disables scheduled workflows in public repositories after 60 days
without a commit. Nothing is lost to a missed run — the queue keeps what is
due — but a repository that goes quiet for two months stops sending mail
silently.

The alternative is **pg_cron**: `supabase/optional/cron_schedule.sql`, after
replacing the two placeholders in it. It is not part of the migrations and
`setup.sql` does not apply it. It has neither of the limitations above.

**Do not run both**, or every email gets two attempts at once. To check
nothing is scheduled in the database:

```sql
select jobname, schedule from cron.job;
```

An error saying the `cron` schema does not exist means nothing is scheduled,
which is what you want when using the workflow.

Request expiry does not depend on this choice. `expire_old_requests()` runs
inside `drain-email-queue` on every invocation, because the pg_cron file
schedules an hourly sweep that the workflow had no way to replicate.

### 3e. Turn the master switch on

Emails stay off until you say so. In the SQL editor:

```sql
update public.admin_settings set value = 'true'::jsonb where key = 'auto_email_enabled';
```

Until you do, matching still runs on every request and recipients are recorded
with status `skipped`, so you can see exactly who would have been contacted.
Nothing is lost by leaving it off while you test.

### 3f. Set the IP salt

Rate limiting is keyed on a hash of the caller's address. The salt is what
stops that hash being reversed, and it is an **Edge Function secret**, set in
the same place as the Gmail ones: **Project Settings** → **Edge Functions** →
**Secrets**.

| Name | Value |
| --- | --- |
| `IP_SALT` | at least 16 characters, 32 or more preferred |

Generate one and keep a copy somewhere safe:

```bash
openssl rand -base64 32
```

> **Do not try to set this in the database.** Earlier versions of this file
> said `alter database postgres set app.ip_salt = '...'`. That cannot work on
> hosted Supabase at any plan level: the `postgres` role there is not the
> database owner, so the statement fails with
> `ERROR: 42501: permission denied to set parameter`. It is a property of the
> platform, not a quota. The salt lives in the Edge Function, which is also
> where the hashing now happens, so the raw address never reaches Postgres at
> all.

**If `IP_SALT` is unset, nothing breaks and nothing throws.** Requests are
still created and emails still queue. What you lose is the IP rate limit: the
function logs an error, sends no hash, and `check_and_record_ip` returns
"allowed" because it has nothing to count. The honeypot field and the
time-on-page check still apply. Changing the salt later is safe — it only
resets the current hour's counters.

### 3g. Check that Bangla actually renders

Sending is not the same as arriving readable. A mail header is US-ASCII by
definition, so a Bangla sender name has to be RFC 2047 encoded; when it was
not, Gmail treated the header block as finished at the first non-ASCII byte
and showed `From`, `To`, `Date`, `MIME-Version` and `Content-Type` as body
text, with the subject displayed as literal `=?utf-8?Q?...`.

There is no way to know it is right except to look in a real inbox, so:

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/drain-email-queue" \
  -H "x-drain-secret: YOUR_DRAIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"test_to":"you@gmail.com"}'
```

One bilingual message, sent immediately, bypassing the queue. In the inbox:

- the subject should read **রক্ত লাগবে — পরীক্ষামূলক বার্তা**, not `=?utf-8?...`
- the body should be Bangla, not `=E0=A6` escape sequences
- `From`, `To` and `Date` should be headers, not text inside the message
- the conjuncts ক্ত ক্ষ ঙ্গ জ্ঞ should be single glyphs, not broken apart

The response echoes the `From` header it sent, so you can compare it with what
the inbox shows without opening message source.

### How to test it safely

1. Leave `auto_email_enabled` **false**.
2. Register yourself as a donor with your own email, in a district you can pick.
3. Send a request for your own blood group in that district.
4. Check `request_recipients`. You should be there with status `skipped`.
5. Now set the switch to true and send another request. Check `email_queue`,
   then run the drain function once by hand:

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/drain-email-queue" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

You should get the email, and the Accept button should work without logging in.

---

## 4. Put it live on GitHub Pages

This repository is an **organisation root site**. It publishes to
`https://roktolagbe-bd.github.io` with no sub-path, which is why
`vite.config.ts` sets `base: '/'`. Do not change that.

1. In the repository on GitHub, open **Settings**, then **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
   Do not pick "Deploy from a branch".
3. Open **Settings**, then **Secrets and variables**, then **Actions**.
4. Add two repository secrets with the same values you used locally:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds the
   site and publishes it.
6. Watch it under the **Actions** tab. The deploy job prints the live URL when
   it finishes.

If you skip step 4 the site still deploys. It just shows the "not connected"
banner.

### Why there is a `404.html`

GitHub Pages serves static files and cannot rewrite URLs. Without help, opening
`https://roktolagbe-bd.github.io/find` directly would fail, and so would the
tokenised links we email to donors.

The build copies `index.html` to `404.html`. GitHub Pages returns that file for
any path it does not recognise, while leaving the address bar alone, so the app
loads and React Router reads the correct path. No redirect, no flicker.

The only side effect is that those pages carry an HTTP 404 status code. People
never notice. Search engines might, and every link we actually publish is a real
path, so it only affects genuine typos.

---

## 5. How the project is laid out

```
src/
  components/   shared UI: the blood grid, buttons, header, footer
  features/     one folder per part of the product
    admin/      the admin panel. Loaded as a separate download.
    home/       landing page data
  lib/          supabase client, i18n, theme, cache, helpers
  locales/      bn.json and en.json. Bangla is the default.
  pages/        one file per route
  styles/       tokens.css is the design system. Read it first.
supabase/       migrations, seed data and Edge Functions (later phases)
scripts/        build helpers
public/         fonts, icons, manifest
```

Two files are worth reading before you change anything visual:

- `src/styles/tokens.css` — every colour, shadow and size in the project, and
  the reasoning behind them.
- `src/components/BloodGroupTile.tsx` — the one element allowed to be loud.

---

## 6. Performance budget

Most people who use this site are on a cheap Android phone on a slow network,
often inside a hospital. The rule is that the first download stays under
**200kb gzipped**.

Current first load: **115kb gzipped**, including CSS. Measured, not estimated:
`npm run build` prints every chunk, and the GitHub Actions run posts a gzipped
summary on each push.

Anything heavy is loaded only when it is actually needed:

| Code | When it loads |
| --- | --- |
| Supabase client | when the page first asks for data |
| Framer Motion features | after the page has already appeared |
| Admin panel, Recharts included | only at `/admin` |
| Registration wizard | only at `/register` |
| Search and request | only at `/find` and `/request` |
| Eligibility, donor wall, learn, privacy | only on those pages |
| Leaflet and the map | only when the map is opened |
| Map and charts | only on the pages that use them |

`npm run build` prints the size of every chunk, and the GitHub Actions run
prints a gzipped summary on every push. If a change pushes the first load over
budget, that shows up in the pull request.

---

## 7. What is built so far

This project is being built in phases.

- [x] **Phase 1** Skeleton, design tokens, routing, Bangla and English, dark
      mode, deploy pipeline
- [x] **Phase 2** Database schema, Row Level Security, districts and upazilas
- [x] **Phase 3** Donor registration, Locate me, map pin
- [x] **Phase 4** Search and the request flow with donor matching
- [x] **Phase 5** Edge Functions and the email pipeline
- [x] **Phase 6** Admin panel
- [x] **Phase 7** Design pass, motion, Bangla copy edit, performance check



---

## Help and contact

- Bugs and ideas: [open an issue](https://github.com/roktolagbe-bd/roktolagbe-bd.github.io/issues)
- Want to help build it: read [CONTRIBUTING.md](CONTRIBUTING.md)
- Email: roktolagbebd@gmail.com

## Licence

MIT. See [LICENSE](LICENSE).

**This site is not a medical service.** In an emergency, contact a hospital
blood bank directly.
