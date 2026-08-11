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

### 2b. Create the tables

In the Supabase dashboard, open **SQL Editor**, then paste and run these files
**in this exact order**. Each one is safe to run twice.

```
supabase/migrations/0001_extensions_enums.sql
supabase/migrations/0002_geo_tables.sql
supabase/migrations/0003_donors.sql
supabase/migrations/0004_requests_recipients.sql
supabase/migrations/0005_email_queue.sql
supabase/migrations/0006_admin_settings_admins_audit.sql
supabase/migrations/0007_views_public.sql
supabase/migrations/0008_functions.sql
supabase/migrations/0009_rls_policies.sql
supabase/migrations/0011_locate_area.sql
supabase/migrations/0012_matcher.sql
supabase/migrations/0013_email_pipeline.sql
supabase/migrations/0014_admin.sql

supabase/seed/001_districts.sql        64 districts
supabase/seed/002_upazilas.sql         494 upazilas
supabase/seed/003_hospitals.sql        42 hospitals
supabase/seed/004_admin_settings.sql   default settings
```

`0010_cron.sql` is optional and only needed once email sending exists. Leave it
for now.

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

1. Sign in to **roktolagbe.bd@gmail.com**.
2. Turn on 2-Step Verification: https://myaccount.google.com/signinoptions/two-step-verification
   App Passwords do not exist until you do.
3. Go to https://myaccount.google.com/apppasswords
4. Type a name, for example `Roktolagbe`, and press **Create**.
5. Copy the 16 characters. Google shows it once. Spaces do not matter.

### 3b. Give the secrets to Supabase

In the Supabase dashboard: **Project Settings** → **Edge Functions** → **Secrets**.

| Name | Value |
| --- | --- |
| `GMAIL_USER` | `roktolagbe.bd@gmail.com` |
| `GMAIL_APP_PASSWORD` | the 16 characters from step 3a |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

**Never put these in this repository, in a `VITE_` variable, or in a GitHub
secret used by the site build.** The App Password can send mail as you. The
service_role key bypasses every privacy rule in the database.

### 3c. Deploy the functions

Install the Supabase CLI (https://supabase.com/docs/guides/cli), then:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy send-request-emails
supabase functions deploy drain-email-queue
supabase functions deploy respond
```

### 3d. Drain the queue on a schedule

Nothing sends by itself. Something has to empty `email_queue`. Pick one:

- **pg_cron**: run `supabase/migrations/0010_cron.sql`, after replacing the two
  placeholders in it. Everything stays inside Supabase.
- **GitHub Actions**: enable `.github/workflows/drain-queue.yml`.

Do not do both, or every email gets two attempts at once.

### 3e. Turn the master switch on

Emails stay off until you say so. In the SQL editor:

```sql
update public.admin_settings set value = 'true'::jsonb where key = 'auto_email_enabled';
```

Until you do, matching still runs on every request and recipients are recorded
with status `skipped`, so you can see exactly who would have been contacted.
Nothing is lost by leaving it off while you test.

### 3f. Set the IP salt

So that hashed IP addresses cannot be reversed:

```sql
alter database postgres set app.ip_salt = 'paste a long random string here';
```

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

Current first load: **about 112kb gzipped**, including CSS.

Anything heavy is loaded only when it is actually needed:

| Code | When it loads |
| --- | --- |
| Supabase client | when the page first asks for data |
| Framer Motion features | after the page has already appeared |
| Admin panel, Recharts included | only at `/admin` |
| Registration wizard | only at `/register` |
| Search and request | only at `/find` and `/request` |
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
- [ ] **Phase 7** Design pass, motion, Bangla copy edit, performance check



---

## Help and contact

- Bugs and ideas: [open an issue](https://github.com/roktolagbe-bd/roktolagbe-bd.github.io/issues)
- Want to help build it: read [CONTRIBUTING.md](CONTRIBUTING.md)
- Email: roktolagbe.bd@gmail.com

## Licence

MIT. See [LICENSE](LICENSE).

**This site is not a medical service.** In an emergency, contact a hospital
blood bank directly.
