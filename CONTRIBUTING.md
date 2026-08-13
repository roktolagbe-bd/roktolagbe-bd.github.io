# Contributing to রক্ত লাগবে

Thank you for wanting to help. This project exists so that someone in
Bangladesh looking for blood at two in the morning finds a person instead of a
dead end.

You do not need to be an expert. Fixing a typo in the Bangla copy is a real
contribution, and so is telling us that a page looked broken on your phone.

---

## The one rule that matters more than the code

**Real people's contact details are in this database.**

Donor phone numbers, WhatsApp numbers, email addresses, Facebook links and
street addresses must never be shown publicly. Not on a page, not in an API
response, not in a map popup, not in a CSV that a stranger can download, not in
a log line, and not in a screenshot attached to an issue.

A donor's contact details are released in exactly one situation: they accepted a
specific request, and then only to the person who made that request.

If a change you are making would put any of that on a public screen, stop and
open an issue first. We will find another way to do it.

See [SECURITY.md](SECURITY.md) for the full picture.

---

## Ways to help that are not code

- **Bangla copy.** Plain, warm, active Bangla. If a sentence sounds like a
  government form or a marketing email, it is wrong. Tell us.
- **District, upazila and hospital data.** Wrong spellings and wrong locations
  cost people time when they have none. Corrections are very welcome.
- **Testing on real phones.** Especially cheap Android devices and slow
  networks. Tell us what broke and what phone you used.
- **Accessibility.** If you use a screen reader or need large text, your report
  is worth more than our guesses.

---

## Getting set up

Follow steps 1 and 2 of the [README](README.md#1-run-it-on-your-own-computer).
You need Node.js 22 or newer.

```bash
npm install
npm run dev
```

Before you open a pull request:

```bash
npx tsc -b       # must pass with no errors
npm run build    # must succeed
```

---

## How we work

1. Open an issue before starting anything large, so two people do not build the
   same thing twice.
2. Branch off `main`. Name it after what it does, for example
   `fix-upazila-spelling` or `add-donor-search-filters`.
3. Keep pull requests small. One idea per pull request is much easier to review.
4. Write commit messages that say what changed and why in plain language.
5. Push to `main` deploys to the live site automatically, so `main` must always
   work.

---

## Things to keep in mind while writing code

**Bangla is the default language, not a translation.** Every new piece of text
goes into both `src/locales/bn.json` and `src/locales/en.json`. Never put a
user-visible string directly in a component. TypeScript will tell you if a key
is missing.

**Test both scripts at every size.** Bangla and Latin have different
proportions. Something that fits in English may overflow in Bangla, and the
other way round. Check at 320px wide.

**The design system is `src/styles/tokens.css`.** Use the tokens. Do not add new
colours without a reason you can explain. All the visual boldness in this
project belongs to the eight blood group tiles; everything else stays quiet.

**Watch the size of the first download.** The budget is 200kb gzipped. Anything
big, a map library, a chart library, the admin panel, must be loaded on demand
with a dynamic `import()`, never at the top of a file that the landing page
reaches. `npm run build` prints the numbers.

**Motion is optional, always.** Every animation must be switched off under
`prefers-reduced-motion`. Use the `useReducedMotion` hook in `src/lib/hooks.ts`.

**Accessibility is not a later step.** Real `<label>` on every input, visible
keyboard focus, a touch target of at least 44px, and 4.5:1 contrast. If you are
not sure, ask in the pull request.

**Security lives in Postgres.** Checking permissions in React is a convenience
for the user, not a protection. Every rule about who can read what must also
exist as a Row Level Security policy. A change to what data is visible needs a
migration, not just a component change.

---

## Reporting a security problem

Do not open a public issue for anything that could expose donor data.

Email **roktolagbebd@gmail.com** with what you found and how to reproduce it.
We will reply as quickly as we can, fix it, and credit you if you would like to
be credited.

---

## Being decent

Be kind and assume good faith. People here are volunteering their evenings.

Harassment, discrimination or abuse of any kind is not accepted, and neither is
using this project's data to contact donors for anything other than a genuine
blood request. Accounts and access will be removed without discussion.
