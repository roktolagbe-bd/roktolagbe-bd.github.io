-- 0017  The donor certificate
--
-- Something to keep and something to post. One donor who shares brings more
-- donors than any amount of copywriting, and the moment right after
-- registering is the only moment they will ever feel like doing it.
--
-- The hard part is not the picture, it is letting somebody get theirs back
-- next year without turning the site into a phone-number oracle.
--
-- Looking a certificate up by phone number cannot be done. The phone would be
-- the input, but the ANSWER is the leak: type a number, learn whether that
-- person is a registered donor, and get their name, blood group and area with
-- it. That is exactly the thing the whole schema is built to prevent, and it
-- does not become safe by being useful.
--
-- So the credential is an unguessable token instead, and it is the donor's to
-- keep. It appears in no view, no search result and no email except the one
-- addressed to them. Recovery goes through the certificate-link Edge Function,
-- which answers every phone number with the same sentence whether it matched
-- or not, and quietly emails the link only when there is an address on file.

-- ---------------------------------------------------------------------------
-- The credential
--
-- Generated in the browser at registration, like the row id, because anon may
-- insert and may not select: there is no way to read a database-generated
-- default back. A v4 UUID from crypto.getRandomValues is 122 random bits,
-- which is not going to be guessed.
--
-- The default is here anyway so that rows created any other way (an admin, a
-- migration, a hand-written insert) still get one.
-- ---------------------------------------------------------------------------
alter table public.donors
  add column if not exists certificate_token uuid not null default gen_random_uuid();

create unique index if not exists donors_certificate_token_idx
  on public.donors (certificate_token);

comment on column public.donors.certificate_token is
  'PRIVATE credential. Whoever holds it can render this donor''s certificate. Never in a view, never in a search result.';

-- ---------------------------------------------------------------------------
-- Reading a certificate
--
-- Deliberately narrow. Everything here is something the donor would put on a
-- poster about themselves; nothing here is a way to reach them. No phone, no
-- email, no address, no coordinates, and no token echoed back.
--
-- full_name is included, unlike everywhere else in this schema. This is the
-- one place it belongs: a certificate with somebody's first name only reads
-- like a mistake, the token is their own credential, and they decide whether
-- the image ever leaves their phone.
-- ---------------------------------------------------------------------------
create or replace function public.donor_certificate(in_token uuid)
returns table (
  full_name text,
  display_name text,
  blood_group public.blood_group,
  area_name text,
  district_en text,
  district_bn text,
  total_donations integer,
  verified boolean,
  joined_month text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.full_name,
    d.display_name,
    d.blood_group,
    d.area_name,
    du.name_en,
    du.name_bn,
    d.total_donations,
    d.verified,
    to_char(d.created_at, 'YYYY-MM')
  from public.donors d
  left join public.districts du on du.id = d.district_id
  where d.certificate_token = in_token
    and not d.blocked
    and d.deleted_at is null
  limit 1;
$$;

-- Anon may call it, because holding the token IS the authorisation. Without a
-- token it returns nothing; there is no way to list or scan.
revoke all on function public.donor_certificate(uuid) from public;
grant execute on function public.donor_certificate(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recovery, for the Edge Function only
--
-- Takes a phone number and returns the email and token IF there is a match.
-- service_role only: this is the one function in the schema that turns a phone
-- number into a person, which is precisely why anon must never reach it. The
-- Edge Function calls it and then says the same thing either way.
-- ---------------------------------------------------------------------------
create or replace function public.certificate_recovery_target(in_phone text)
returns table (donor_email citext, certificate_token uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select d.email, d.certificate_token, d.display_name
  from public.donors d
  where d.phone = btrim(in_phone)
    and d.email is not null
    and not d.blocked
    and d.deleted_at is null
  limit 1;
$$;

revoke all on function public.certificate_recovery_target(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Not a mail bomb
--
-- The recovery endpoint answers identically whether or not a number matched,
-- so there is nothing to learn by hammering it. There is still something to
-- inflict: repeat it enough and a donor's inbox fills up. One recovery email
-- per address per hour is plenty for somebody who mislaid a link.
-- ---------------------------------------------------------------------------
create or replace function public.certificate_link_recently_sent(in_email citext)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.email_queue q
    where q.to_email = in_email
      and q.kind = 'certificate_link'
      and q.created_at > now() - interval '1 hour'
  );
$$;

revoke all on function public.certificate_link_recently_sent(citext) from public, anon, authenticated;
