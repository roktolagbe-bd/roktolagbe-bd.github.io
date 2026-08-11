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

> **Is it safe to share the anon key?** Yes. It is designed to be public and it
> ends up inside the built site either way. What protects donor phone numbers is
> Row Level Security inside Postgres, not secrecy of this key. The key you must
> never share is the **service_role** key. It bypasses every rule. It belongs
> only in Supabase Edge Function secrets, never in this repository and never in
> a `VITE_` variable.

---

## 3. Put it live on GitHub Pages

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

## 4. How the project is laid out

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

## 5. Performance budget

Most people who use this site are on a cheap Android phone on a slow network,
often inside a hospital. The rule is that the first download stays under
**200kb gzipped**.

Current first load: **about 103kb gzipped**, including CSS.

Anything heavy is loaded only when it is actually needed:

| Code | When it loads |
| --- | --- |
| Supabase client | when the page first asks for data |
| Framer Motion features | after the page has already appeared |
| Admin panel | only at `/admin` |
| Map and charts | only on the pages that use them |

`npm run build` prints the size of every chunk, and the GitHub Actions run
prints a gzipped summary on every push. If a change pushes the first load over
budget, that shows up in the pull request.

---

## 6. What is built so far

This project is being built in phases.

- [x] **Phase 1** Skeleton, design tokens, routing, Bangla and English, dark
      mode, deploy pipeline
- [ ] **Phase 2** Database schema, Row Level Security, districts and upazilas
- [ ] **Phase 3** Donor registration, Locate me, map pin
- [ ] **Phase 4** Search and the request flow with donor matching
- [ ] **Phase 5** Edge Functions and the email pipeline
- [ ] **Phase 6** Admin panel
- [ ] **Phase 7** Design pass, motion, Bangla copy edit, performance check

Instructions for running database migrations and setting up Gmail sending will
be added to this file in Phases 2 and 5, once those parts exist.

---

## Help and contact

- Bugs and ideas: [open an issue](https://github.com/roktolagbe-bd/roktolagbe-bd.github.io/issues)
- Want to help build it: read [CONTRIBUTING.md](CONTRIBUTING.md)
- Email: roktolagbe.bd@gmail.com

## Licence

MIT. See [LICENSE](LICENSE).

**This site is not a medical service.** In an emergency, contact a hospital
blood bank directly.
