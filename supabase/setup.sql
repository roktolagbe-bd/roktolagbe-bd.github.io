-- Roktolagbe: complete database setup
--
-- GENERATED FILE. Do not edit by hand.
-- Regenerate with:  node scripts/build-setup-sql.mjs
--
-- Paste this whole file into the Supabase SQL editor and run it. It creates
-- every table, view, function and security policy the site needs.
-- 
-- It runs in one transaction, so either the whole database is created or
-- nothing is. Safe to run more than once.
-- 
-- Then run supabase/seed.sql for the districts, upazilas and hospitals.
-- 
-- After running both, check the privacy rules took effect. This must return
-- zero rows:
-- 
--   select tablename from pg_tables t where schemaname = 'public'
--     and not exists (select 1 from pg_class c
--                     where c.relname = t.tablename and c.relrowsecurity);

begin;

-- ==========================================================================
-- 20260811000001_extensions_enums.sql
-- ==========================================================================

-- 0001  Extensions and enumerated types
--
-- Paste these migration files into the Supabase SQL editor in numeric order.
-- Every file is safe to run twice.
--
-- Read supabase/migrations/0009_rls_policies.sql before changing anything in
-- here. The privacy rules of this project are enforced in Postgres, and the
-- shape of these tables is what makes that possible.

create extension if not exists "pgcrypto"; -- gen_random_uuid(), digest()
create extension if not exists "citext"; -- case-insensitive email

-- Enum types are created guarded so a re-run does not error.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'blood_group') then
    create type public.blood_group as enum ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');
  end if;

  if not exists (select 1 from pg_type where typname = 'urgency_level') then
    create type public.urgency_level as enum ('critical', 'urgent', 'scheduled');
  end if;

  if not exists (select 1 from pg_type where typname = 'request_status') then
    create type public.request_status as enum ('open', 'matched', 'fulfilled', 'expired', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'email_status') then
    create type public.email_status as enum ('queued', 'sent', 'failed', 'skipped');
  end if;

  if not exists (select 1 from pg_type where typname = 'response_status') then
    create type public.response_status as enum ('pending', 'accepted', 'declined');
  end if;
end
$$;

-- Keeps updated_at honest without the application having to remember.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ==========================================================================
-- 20260811000002_geo_tables.sql
-- ==========================================================================

-- 0002  Places: districts, upazilas, hospitals, and the geocode cache
--
-- These four tables hold no personal data. Districts, upazilas and hospitals
-- are public reference data that anyone may read. The geocode cache is not
-- readable by the public, because a cache of looked-up addresses is a record
-- of where people have been searching.

create table if not exists public.districts (
  id          integer primary key,
  name_en     text not null,
  name_bn     text not null,
  division_en text,
  division_bn text,
  lat         double precision not null,
  lng         double precision not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.upazilas (
  id          integer primary key,
  district_id integer not null references public.districts (id) on delete cascade,
  name_en     text not null,
  name_bn     text not null,
  -- Nullable on purpose. A handful of upazilas have no boundary polygon in the
  -- open data, and the app falls back to the district centroid for those.
  -- An honest NULL beats a confident wrong point.
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now()
);

create index if not exists upazilas_district_idx on public.upazilas (district_id);

create table if not exists public.hospitals (
  id          uuid primary key default gen_random_uuid(),
  name_en     text not null,
  name_bn     text,
  district_id integer references public.districts (id) on delete set null,
  upazila_id  integer references public.upazilas (id) on delete set null,
  address     text,
  phone       text, -- a hospital switchboard, not a person. Safe to show.
  lat         double precision,
  lng         double precision,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists hospitals_district_idx on public.hospitals (district_id);
create index if not exists hospitals_active_idx on public.hospitals (is_active) where is_active;

drop trigger if exists hospitals_set_updated_at on public.hospitals;
create trigger hospitals_set_updated_at
  before update on public.hospitals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Geocode cache
--
-- Nominatim's usage policy asks for at most one request per second and a real
-- User-Agent. A browser cannot set a User-Agent, so all geocoding goes through
-- the `geocode` Edge Function, which writes here. Keyed on coordinates rounded
-- to three decimals, roughly 110 metres, so nearby lookups share an entry.
-- ---------------------------------------------------------------------------
create table if not exists public.geocode_cache (
  id           bigserial primary key,
  lat_key      numeric(6, 3) not null,
  lng_key      numeric(6, 3) not null,
  display_name text,
  district_id  integer references public.districts (id) on delete set null,
  upazila_id   integer references public.upazilas (id) on delete set null,
  raw          jsonb,
  created_at   timestamptz not null default now(),
  unique (lat_key, lng_key)
);

-- ==========================================================================
-- 20260811000003_donors.sql
-- ==========================================================================

-- 0003  Donors
--
-- This is the table the whole privacy design exists to protect. Read the
-- column comments before touching it.
--
-- The rule: phone, whatsapp, email, facebook_url and address_line are NEVER
-- readable by an anonymous visitor, under any query, through any view. They
-- are released only to a requester whose specific request this donor accepted.
-- 0009_rls_policies.sql is what enforces that.

create table if not exists public.donors (
  id           uuid primary key default gen_random_uuid(),

  -- Identity
  full_name    text not null,
  -- Shown publicly. Defaults to the first word of full_name so a donor never
  -- accidentally publishes their full legal name.
  display_name text not null,
  blood_group  public.blood_group not null,

  -- Contact. PRIVATE. Never selectable by anon. See 0007 and 0009.
  phone        text not null,
  whatsapp     text,
  email        citext,
  facebook_url text,

  -- Location
  district_id  integer references public.districts (id) on delete set null,
  upazila_id   integer references public.upazilas (id) on delete set null,
  address_line text, -- PRIVATE. Street level. Never public.

  -- True coordinates. PRIVATE, admin only. Used for matching inside the
  -- database, never returned to a browser.
  lat          double precision,
  lng          double precision,

  -- Public coordinates: rounded to 3 decimals and pushed by a random offset of
  -- up to 800 metres. This is the only position the public map ever plots.
  -- Written by a trigger so it cannot drift out of sync with lat/lng.
  lat_fuzzed   double precision,
  lng_fuzzed   double precision,

  -- Eligibility
  date_of_birth     date,
  weight_kg         numeric(5, 2),
  last_donation_date date,
  total_donations   integer not null default 0 check (total_donations >= 0),

  -- Moderation
  verified     boolean not null default false,
  blocked      boolean not null default false,

  -- Consent. Both default to false: consent is given, never assumed.
  consent_email          boolean not null default false,
  consent_public_listing boolean not null default false,

  -- Every outgoing email carries this token in its opt-out link.
  opt_out_token uuid not null default gen_random_uuid(),

  -- Abuse control. A salted hash, never a raw IP address.
  ip_hash      text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint donors_weight_sane check (weight_kg is null or (weight_kg between 30 and 250)),
  constraint donors_dob_sane check (date_of_birth is null or date_of_birth < current_date),
  constraint donors_last_donation_not_future
    check (last_donation_date is null or last_donation_date <= current_date)
);

-- ---------------------------------------------------------------------------
-- Availability
--
-- The brief asked for `is_available` as a generated column. Postgres will not
-- allow that: a generated column's expression must be IMMUTABLE, and this one
-- needs both now() and a cooldown value read from admin_settings. Neither is.
--
-- So the stored column is `next_eligible_date`, which IS immutable, and
-- `is_available` is computed live wherever it is needed: in the public views
-- and in nearby_donors(). The API still returns a field called is_available,
-- and the admin cooldown setting takes effect immediately instead of being
-- frozen into the table at write time.
--
-- 120 days here is the fallback used only for the index. The real cooldown
-- comes from admin_settings.donor_cooldown_days at query time.
-- ---------------------------------------------------------------------------
alter table public.donors
  drop column if exists next_eligible_date;

alter table public.donors
  add column next_eligible_date date
  generated always as (last_donation_date + interval '120 days') stored;

create index if not exists donors_group_available_idx
  on public.donors (blood_group, next_eligible_date)
  where not blocked;

create index if not exists donors_district_idx on public.donors (district_id) where not blocked;
create index if not exists donors_upazila_idx on public.donors (upazila_id) where not blocked;
create index if not exists donors_location_idx on public.donors (lat, lng) where not blocked;
create index if not exists donors_opt_out_token_idx on public.donors (opt_out_token);
create index if not exists donors_ip_hash_idx on public.donors (ip_hash, created_at);
create index if not exists donors_wall_idx
  on public.donors (consent_public_listing, total_donations desc)
  where consent_public_listing and not blocked;

-- One person, one row per phone number.
create unique index if not exists donors_phone_key on public.donors (phone);

drop trigger if exists donors_set_updated_at on public.donors;
create trigger donors_set_updated_at
  before update on public.donors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Coordinate fuzzing
--
-- Rounding alone is not enough: rounding is reversible in aggregate and puts
-- every donor in a neighbourhood on the same grid point. A random offset of up
-- to 800 metres, applied once at write time and stored, means the public point
-- is stable (it does not jitter between page loads, which would let someone
-- average out the true position) but is not the real address.
-- ---------------------------------------------------------------------------
create or replace function public.fuzz_point(in_lat double precision, in_lng double precision)
returns table (out_lat double precision, out_lng double precision)
language plpgsql
as $$
declare
  bearing double precision;
  distance_m double precision;
  d_lat double precision;
  d_lng double precision;
begin
  if in_lat is null or in_lng is null then
    return query select null::double precision, null::double precision;
    return;
  end if;

  bearing := random() * 2 * pi();
  -- sqrt() spreads points evenly over the disc instead of clustering them
  -- in the middle, which would make the true point easier to guess.
  distance_m := 800 * sqrt(random());

  d_lat := (distance_m * cos(bearing)) / 111320.0;
  d_lng := (distance_m * sin(bearing)) / (111320.0 * cos(radians(in_lat)));

  return query select
    round((in_lat + d_lat)::numeric, 3)::double precision,
    round((in_lng + d_lng)::numeric, 3)::double precision;
end;
$$;

create or replace function public.donors_apply_fuzz()
returns trigger
language plpgsql
as $$
declare
  fuzzed record;
begin
  -- Only recompute when the true point actually moved, so the published point
  -- stays put across unrelated edits.
  if tg_op = 'INSERT'
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng then
    select * into fuzzed from public.fuzz_point(new.lat, new.lng);
    new.lat_fuzzed := fuzzed.out_lat;
    new.lng_fuzzed := fuzzed.out_lng;
  end if;

  -- A donor who never chose a display name should not have their full legal
  -- name published by default.
  if new.display_name is null or btrim(new.display_name) = '' then
    new.display_name := split_part(btrim(new.full_name), ' ', 1);
  end if;

  return new;
end;
$$;

drop trigger if exists donors_apply_fuzz on public.donors;
create trigger donors_apply_fuzz
  before insert or update on public.donors
  for each row execute function public.donors_apply_fuzz();

comment on column public.donors.phone is 'PRIVATE. Released only to a requester this donor accepted.';
comment on column public.donors.email is 'PRIVATE. Used for request notifications and nothing else.';
comment on column public.donors.address_line is 'PRIVATE. Street level. Never leaves the database.';
comment on column public.donors.lat is 'PRIVATE true position. The public sees lat_fuzzed only.';
comment on column public.donors.lng is 'PRIVATE true position. The public sees lng_fuzzed only.';

-- ==========================================================================
-- 20260811000004_requests_recipients.sql
-- ==========================================================================

-- 0004  Blood requests and who was contacted about them
--
-- A blood_request holds the requester's own contact details, which are as
-- private as a donor's. They are shown to a donor only inside the email about
-- that specific request, and on the tokenised response page.

create table if not exists public.blood_requests (
  id                uuid primary key default gen_random_uuid(),

  -- Requester. PRIVATE.
  requester_name    text not null,
  requester_phone   text not null,
  requester_whatsapp text,
  requester_email   citext,

  -- What is needed
  blood_group  public.blood_group not null,
  units_needed integer not null default 1 check (units_needed between 1 and 20),
  urgency      public.urgency_level not null default 'urgent',

  -- Where
  hospital_id            uuid references public.hospitals (id) on delete set null,
  hospital_name_free_text text,
  district_id  integer references public.districts (id) on delete set null,
  upazila_id   integer references public.upazilas (id) on delete set null,
  lat          double precision,
  lng          double precision,

  needed_by    timestamptz,
  patient_note text,

  status       public.request_status not null default 'open',

  -- How far the matcher reached before it stopped expanding.
  match_radius_km integer not null default 5,

  -- Salted hash, never a raw IP. Drives the 3-per-hour cap.
  ip_hash      text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A request must say where it is, one way or another, or nobody can be
  -- matched to it.
  constraint blood_requests_has_location
    check (district_id is not null or (lat is not null and lng is not null)),
  constraint blood_requests_has_hospital
    check (hospital_id is not null or nullif(btrim(coalesce(hospital_name_free_text, '')), '') is not null)
);

create index if not exists blood_requests_status_idx on public.blood_requests (status, created_at desc);
create index if not exists blood_requests_group_idx on public.blood_requests (blood_group, status);
create index if not exists blood_requests_district_idx on public.blood_requests (district_id);
create index if not exists blood_requests_ip_hash_idx on public.blood_requests (ip_hash, created_at);

drop trigger if exists blood_requests_set_updated_at on public.blood_requests;
create trigger blood_requests_set_updated_at
  before update on public.blood_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- request_recipients
--
-- One row per donor we told about one request. This table is the audit trail
-- for "who did we email, and what did they say", and it holds the response
-- token that lets a donor answer without logging in.
-- ---------------------------------------------------------------------------
create table if not exists public.request_recipients (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.blood_requests (id) on delete cascade,
  donor_id     uuid not null references public.donors (id) on delete cascade,

  distance_km  numeric(6, 2),

  email_status public.email_status not null default 'queued',
  sent_at      timestamptz,

  response     public.response_status not null default 'pending',
  -- Single use, tied to one donor and one request. Dies with the request.
  response_token uuid not null default gen_random_uuid(),
  responded_at timestamptz,

  created_at   timestamptz not null default now(),

  -- Never tell the same donor about the same request twice.
  unique (request_id, donor_id)
);

create unique index if not exists request_recipients_token_idx
  on public.request_recipients (response_token);
create index if not exists request_recipients_request_idx
  on public.request_recipients (request_id);
create index if not exists request_recipients_donor_idx
  on public.request_recipients (donor_id, created_at desc);
create index if not exists request_recipients_email_status_idx
  on public.request_recipients (email_status) where email_status = 'queued';

-- When a donor accepts, bump their donation count and start their cooldown
-- only when an admin marks the request fulfilled. Accepting is a promise, not
-- a donation, so this trigger records the promise and nothing more.
create or replace function public.request_recipients_stamp_response()
returns trigger
language plpgsql
as $$
begin
  if new.response is distinct from old.response and new.response <> 'pending' then
    new.responded_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists request_recipients_stamp_response on public.request_recipients;
create trigger request_recipients_stamp_response
  before update on public.request_recipients
  for each row execute function public.request_recipients_stamp_response();

comment on column public.blood_requests.requester_phone is
  'PRIVATE. Shown only to donors who were contacted about this request.';
comment on column public.request_recipients.response_token is
  'Single use. Grants no access beyond answering this one request.';

-- ==========================================================================
-- 20260811000005_email_queue.sql
-- ==========================================================================

-- 0005  Email queue
--
-- Nothing sends mail directly. Everything is written here first and drained on
-- a schedule, because free Gmail allows roughly 500 recipients a day and a
-- burst of 25 emails the moment someone hits submit is how an account gets
-- locked. The queue is also what makes retries and a daily cap possible.

create table if not exists public.email_queue (
  id            uuid primary key default gen_random_uuid(),
  to_email      citext not null,
  subject       text not null,
  html_body     text not null,
  text_body     text not null, -- Gmail on Android needs the plain part

  attempts      integer not null default 0,
  status        public.email_status not null default 'queued',
  last_error    text,

  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz,

  -- What this email is about, so admin can trace a failure back to a request
  -- and so a retry can be attributed.
  request_id    uuid references public.blood_requests (id) on delete set null,
  recipient_id  uuid references public.request_recipients (id) on delete set null,
  kind          text not null default 'donor_request',

  created_at    timestamptz not null default now(),

  constraint email_queue_attempts_sane check (attempts >= 0 and attempts <= 10)
);

-- The drain function's hot path: what is due, oldest first.
create index if not exists email_queue_due_idx
  on public.email_queue (scheduled_for)
  where status = 'queued';

create index if not exists email_queue_status_idx on public.email_queue (status, created_at desc);
create index if not exists email_queue_sent_at_idx on public.email_queue (sent_at)
  where status = 'sent';

comment on table public.email_queue is
  'Outbound mail. Drained by the drain-email-queue Edge Function, never by the browser.';
comment on column public.email_queue.attempts is
  'Three tries with backoff, then marked failed and surfaced in the admin panel.';

-- ==========================================================================
-- 20260811000006_admin_settings_admins_audit.sql
-- ==========================================================================

-- 0006  Settings, the admin allowlist, and the audit log

-- ---------------------------------------------------------------------------
-- admin_settings
--
-- A key/value store so an admin can change how the system behaves without a
-- deploy. auto_email_enabled is the important one: it is the master switch,
-- and every send path reads it before doing anything.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

drop trigger if exists admin_settings_set_updated_at on public.admin_settings;
create trigger admin_settings_set_updated_at
  before update on public.admin_settings
  for each row execute function public.set_updated_at();

-- Reads one setting with a fallback, so a missing row can never take the site
-- down or, worse, silently start sending mail that was meant to be off.
create or replace function public.get_setting(setting_key text, fallback jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce((select value from public.admin_settings where key = setting_key), fallback);
$$;

create or replace function public.setting_int(setting_key text, fallback integer)
returns integer
language sql
stable
as $$
  select coalesce(nullif(public.get_setting(setting_key, to_jsonb(fallback)) #>> '{}', ''), fallback::text)::integer;
$$;

create or replace function public.setting_bool(setting_key text, fallback boolean)
returns boolean
language sql
stable
as $$
  select coalesce((public.get_setting(setting_key, to_jsonb(fallback)) #>> '{}')::boolean, fallback);
$$;

-- ---------------------------------------------------------------------------
-- admins
--
-- An allowlist. Having a valid Supabase session is not enough to reach the
-- admin panel; the user id must also be a row here. Adding an admin is a
-- deliberate act by an existing admin.
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      citext,
  full_name  text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- Used by nearly every policy in 0009. SECURITY DEFINER so that checking
-- "am I an admin" does not itself require permission to read the admins table,
-- which would be circular.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid() and is_active
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- audit_log
--
-- Anything an admin does to someone else's data leaves a trace. Nobody can
-- edit or delete rows here, including admins.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id           bigserial primary key,
  actor_id     uuid,
  action       text not null,
  target_table text,
  target_id    text,
  payload      jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_target_idx on public.audit_log (target_table, target_id);

create or replace function public.write_audit(
  in_action text,
  in_table text,
  in_target text,
  in_payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, auth
as $$
  insert into public.audit_log (actor_id, action, target_table, target_id, payload)
  values (auth.uid(), in_action, in_table, in_target, in_payload);
$$;

-- ==========================================================================
-- 20260811000007_views_public.sql
-- ==========================================================================

-- 0007  The only things the public may read
--
-- Everything an anonymous visitor can see comes from this file. If a column is
-- not listed in one of these views, no anonymous query can reach it.
--
-- These views are declared `security_invoker = off` (the default for views),
-- so they run with the privileges of their owner and can read the underlying
-- tables even though anon has no grant on them. That is exactly the point: the
-- view is the keyhole, and it is shaped to fit only non-identifying data.
--
-- NOT PRESENT IN ANY VIEW BELOW, and that is deliberate:
--   full_name, phone, whatsapp, email, facebook_url, address_line,
--   lat, lng (true position), date_of_birth, ip_hash, opt_out_token.

-- ---------------------------------------------------------------------------
-- donors_public
--
-- What a search result is allowed to contain: a first name, a blood group, an
-- area, availability, and a fuzzed point. Nothing that identifies or reaches
-- a person.
-- ---------------------------------------------------------------------------
drop view if exists public.donors_public cascade;
create view public.donors_public as
select
  d.id,
  d.display_name,
  d.blood_group,
  d.district_id,
  du.name_en as district_en,
  du.name_bn as district_bn,
  d.upazila_id,
  u.name_en as upazila_en,
  u.name_bn as upazila_bn,

  -- The fuzzed point only. The true one never appears in a view.
  d.lat_fuzzed,
  d.lng_fuzzed,

  d.verified,
  d.total_donations,

  -- Computed live against the current cooldown setting rather than frozen
  -- into the row. See the note in 0003.
  (
    d.last_donation_date is null
    or d.last_donation_date + (public.setting_int('donor_cooldown_days', 120) || ' days')::interval
       <= now()
  ) as is_available,

  -- Month precision. The exact date of a donation is a movement record.
  to_char(d.last_donation_date, 'YYYY-MM') as last_donation_month
from public.donors d
left join public.districts du on du.id = d.district_id
left join public.upazilas u on u.id = d.upazila_id
where not d.blocked
  and d.consent_public_listing;

-- ---------------------------------------------------------------------------
-- wall_of_donors
--
-- The social proof page. Same consent gate, ordered so that showing up feels
-- like something worth doing.
-- ---------------------------------------------------------------------------
drop view if exists public.wall_of_donors cascade;
create view public.wall_of_donors as
select
  d.id,
  d.display_name,
  d.blood_group,
  du.name_en as district_en,
  du.name_bn as district_bn,
  d.total_donations,
  d.verified,
  date_trunc('month', d.created_at)::date as joined_month
from public.donors d
left join public.districts du on du.id = d.district_id
where d.consent_public_listing
  and not d.blocked
order by d.total_donations desc, d.created_at asc;

-- ---------------------------------------------------------------------------
-- Landing page counters
--
-- Aggregates only. Note that these count ALL donors, including those who did
-- not consent to public listing: a count is not personal data, and the number
-- of people who signed up is the honest number. No row is identifiable.
-- ---------------------------------------------------------------------------
drop view if exists public.public_stats cascade;
create view public.public_stats as
select 'donors_total' as metric, count(*)::bigint as value
from public.donors where not blocked
union all
select 'requests_fulfilled', count(*)::bigint
from public.blood_requests where status = 'fulfilled'
union all
select 'districts_covered', count(distinct district_id)::bigint
from public.donors where not blocked and district_id is not null;

-- ---------------------------------------------------------------------------
-- The blood grid on the landing page
--
-- Availability per group, across every donor, not just the publicly listed
-- ones. This is what makes the eight tiles a live object.
-- ---------------------------------------------------------------------------
drop view if exists public.public_group_availability cascade;
create view public.public_group_availability as
select
  d.blood_group,
  count(*) filter (
    where d.last_donation_date is null
       or d.last_donation_date + (public.setting_int('donor_cooldown_days', 120) || ' days')::interval <= now()
  )::bigint as available,
  count(*)::bigint as total
from public.donors d
where not d.blocked
group by d.blood_group;

-- ---------------------------------------------------------------------------
-- Hospitals and places, for the dropdowns
-- ---------------------------------------------------------------------------
drop view if exists public.hospitals_public cascade;
create view public.hospitals_public as
select id, name_en, name_bn, district_id, upazila_id, address, phone, lat, lng
from public.hospitals
where is_active;

comment on view public.donors_public is
  'The ONLY donor data anonymous visitors can read. No contact columns, fuzzed position only.';

-- ==========================================================================
-- 20260811000008_functions.sql
-- ==========================================================================

-- 0008  Matching, rate limiting, and the tokenised donor response
--
-- Every function here that touches private data is SECURITY DEFINER and
-- returns only what the caller is entitled to. None of them ever return a
-- donor's phone number to an anonymous caller except the one narrow case the
-- whole product exists for: a donor accepted a request, so that requester
-- gets that donor's number.

-- ---------------------------------------------------------------------------
-- Distance
-- ---------------------------------------------------------------------------
create or replace function public.haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ---------------------------------------------------------------------------
-- nearby_donors
--
-- The public search. Returns the same shape as donors_public plus a distance,
-- and only donors who consented to public listing.
--
-- Distance is measured from the TRUE donor position so the ranking is honest,
-- but the position returned is the fuzzed one. The caller learns "about 3km
-- away", never where.
-- ---------------------------------------------------------------------------
create or replace function public.nearby_donors(
  in_blood_group public.blood_group,
  in_lat double precision,
  in_lng double precision,
  in_radius_km double precision default 25,
  in_max_results integer default 50
)
returns table (
  id uuid,
  display_name text,
  blood_group public.blood_group,
  district_id integer,
  district_en text,
  district_bn text,
  upazila_id integer,
  upazila_en text,
  upazila_bn text,
  lat_fuzzed double precision,
  lng_fuzzed double precision,
  verified boolean,
  total_donations integer,
  is_available boolean,
  last_donation_month text,
  distance_km double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with cooldown as (
    select public.setting_int('donor_cooldown_days', 120) as days
  )
  select
    d.id,
    d.display_name,
    d.blood_group,
    d.district_id,
    du.name_en,
    du.name_bn,
    d.upazila_id,
    u.name_en,
    u.name_bn,
    d.lat_fuzzed,
    d.lng_fuzzed,
    d.verified,
    d.total_donations,
    (d.last_donation_date is null
      or d.last_donation_date + (c.days || ' days')::interval <= now()) as is_available,
    to_char(d.last_donation_date, 'YYYY-MM'),
    round(public.haversine_km(in_lat, in_lng, d.lat, d.lng)::numeric, 1)::double precision
  from public.donors d
  cross join cooldown c
  left join public.districts du on du.id = d.district_id
  left join public.upazilas u on u.id = d.upazila_id
  where not d.blocked
    and d.consent_public_listing
    and d.blood_group = in_blood_group
    and d.lat is not null
    and d.lng is not null
    and public.haversine_km(in_lat, in_lng, d.lat, d.lng) <= in_radius_km
  order by
    (d.last_donation_date is null
      or d.last_donation_date + (c.days || ' days')::interval <= now()) desc,
    public.haversine_km(in_lat, in_lng, d.lat, d.lng) asc
  limit least(coalesce(in_max_results, 50), 200);
$$;

revoke all on function public.nearby_donors(public.blood_group, double precision, double precision, double precision, integer) from public;
grant execute on function public.nearby_donors(public.blood_group, double precision, double precision, double precision, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- match_donors_for_request
--
-- Used by the send-request-emails Edge Function, which runs as service_role.
-- Returns donor ids and emails, so it must never be callable by anon.
--
-- Consent rules differ from public search on purpose: a donor who declined
-- public listing can still be emailed if they consented to email. They chose
-- not to be browsable, not to be unreachable in an emergency.
-- ---------------------------------------------------------------------------
create or replace function public.match_donors_for_request(
  in_request_id uuid,
  in_radius_km double precision,
  in_max_results integer
)
returns table (donor_id uuid, email citext, distance_km double precision)
language sql
stable
security definer
set search_path = public
as $$
  with req as (
    select r.*, coalesce(r.lat, dis.lat) as origin_lat, coalesce(r.lng, dis.lng) as origin_lng
    from public.blood_requests r
    left join public.districts dis on dis.id = r.district_id
    where r.id = in_request_id
  ),
  cooldown as (select public.setting_int('donor_cooldown_days', 120) as days)
  select
    d.id,
    d.email,
    round(public.haversine_km(req.origin_lat, req.origin_lng, d.lat, d.lng)::numeric, 1)::double precision
  from public.donors d
  cross join req
  cross join cooldown c
  where not d.blocked
    and d.consent_email
    and d.email is not null
    and d.blood_group = req.blood_group
    and d.lat is not null and d.lng is not null
    and (d.last_donation_date is null
         or d.last_donation_date + (c.days || ' days')::interval <= now())
    and public.haversine_km(req.origin_lat, req.origin_lng, d.lat, d.lng) <= in_radius_km
    -- Never contact the same donor twice about the same request.
    and not exists (
      select 1 from public.request_recipients rr
      where rr.request_id = in_request_id and rr.donor_id = d.id
    )
  order by public.haversine_km(req.origin_lat, req.origin_lng, d.lat, d.lng) asc
  limit greatest(coalesce(in_max_results, 25), 0);
$$;

revoke all on function public.match_donors_for_request(uuid, double precision, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Abuse control
--
-- Raw IP addresses are never stored. The Edge Function hashes the address with
-- a server-side salt before it reaches the database, so a leak of this table
-- does not reveal who was searching for blood.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_request_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
  cap integer := public.setting_int('max_requests_per_ip_per_hour', 3);
begin
  if new.ip_hash is null then
    return new; -- nothing to key on; the honeypot and timing checks still apply
  end if;

  select count(*) into recent
  from public.blood_requests
  where ip_hash = new.ip_hash
    and created_at > now() - interval '1 hour';

  if recent >= cap then
    raise exception 'rate_limit_exceeded'
      using hint = 'Too many requests from this connection in the last hour.',
            errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists blood_requests_rate_limit on public.blood_requests;
create trigger blood_requests_rate_limit
  before insert on public.blood_requests
  for each row execute function public.enforce_request_rate_limit();

create or replace function public.enforce_donor_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
  cap integer := public.setting_int('max_registrations_per_ip_per_hour', 3);
begin
  if new.ip_hash is null then
    return new;
  end if;

  select count(*) into recent
  from public.donors
  where ip_hash = new.ip_hash
    and created_at > now() - interval '1 hour';

  if recent >= cap then
    raise exception 'rate_limit_exceeded'
      using hint = 'Too many registrations from this connection in the last hour.',
            errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists donors_rate_limit on public.donors;
create trigger donors_rate_limit
  before insert on public.donors
  for each row execute function public.enforce_donor_rate_limit();

-- ---------------------------------------------------------------------------
-- The donor response page
--
-- Reached from a link in an email. No login, no session, just a token that is
-- good for one request and one donor.
--
-- get_request_by_token returns the requester's contact details, because a
-- donor deciding whether to help is entitled to know who is asking. It returns
-- nothing at all once the request is closed, so an old email cannot be used to
-- mine contact details later.
-- ---------------------------------------------------------------------------
create or replace function public.get_request_by_token(in_token uuid)
returns table (
  request_id uuid,
  blood_group public.blood_group,
  units_needed integer,
  urgency public.urgency_level,
  hospital_name text,
  district_en text,
  district_bn text,
  needed_by timestamptz,
  patient_note text,
  requester_name text,
  status public.request_status,
  distance_km numeric,
  already_responded public.response_status
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.blood_group,
    r.units_needed,
    r.urgency,
    coalesce(h.name_en, r.hospital_name_free_text),
    d.name_en,
    d.name_bn,
    r.needed_by,
    r.patient_note,
    r.requester_name,
    r.status,
    rr.distance_km,
    rr.response
  from public.request_recipients rr
  join public.blood_requests r on r.id = rr.request_id
  left join public.hospitals h on h.id = r.hospital_id
  left join public.districts d on d.id = r.district_id
  where rr.response_token = in_token
    and r.status in ('open', 'matched');
$$;

revoke all on function public.get_request_by_token(uuid) from public;
grant execute on function public.get_request_by_token(uuid) to anon, authenticated;

-- Accept or decline. On accept, the requester's contact details are returned
-- to the donor, and the mailer separately sends the donor's details to the
-- requester. This is the only path by which contact information moves.
create or replace function public.respond_to_request(in_token uuid, in_accept boolean)
returns table (
  ok boolean,
  requester_name text,
  requester_phone text,
  requester_whatsapp text,
  hospital_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  select rr.*, r.status as request_status
  into rec
  from public.request_recipients rr
  join public.blood_requests r on r.id = rr.request_id
  where rr.response_token = in_token
  for update;

  if not found or rec.request_status not in ('open', 'matched') then
    return query select false, null::text, null::text, null::text, null::text;
    return;
  end if;

  update public.request_recipients
  set response = case when in_accept then 'accepted' else 'declined' end::public.response_status
  where id = rec.id;

  if in_accept then
    update public.blood_requests
    set status = 'matched'
    where id = rec.request_id and status = 'open';

    return query
    select true, r.requester_name, r.requester_phone, r.requester_whatsapp,
           coalesce(h.name_en, r.hospital_name_free_text)
    from public.blood_requests r
    left join public.hospitals h on h.id = r.hospital_id
    where r.id = rec.request_id;
  else
    return query select true, null::text, null::text, null::text, null::text;
  end if;
end;
$$;

revoke all on function public.respond_to_request(uuid, boolean) from public;
grant execute on function public.respond_to_request(uuid, boolean) to anon, authenticated;

-- Opt out. One click from any email, no login, no confirmation screen that
-- talks someone out of it.
create or replace function public.opt_out_donor(in_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.donors
  set consent_email = false, consent_public_listing = false
  where opt_out_token = in_token;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.opt_out_donor(uuid) from public;
grant execute on function public.opt_out_donor(uuid) to anon, authenticated;

-- Remaining Gmail allowance for today, shown in the admin panel.
create or replace function public.email_quota_remaining()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    0,
    public.setting_int('daily_email_cap', 400)
      - (select count(*)::integer from public.email_queue
         where status = 'sent' and sent_at > date_trunc('day', now()))
  );
$$;

-- ==========================================================================
-- 20260811000009_rls_policies.sql
-- ==========================================================================

-- 0009  Row Level Security
--
-- This is the file that protects real people. Everything else is convenience.
--
-- The model in one paragraph: RLS is ON for every table, and no table has a
-- SELECT policy for anon. Anonymous visitors read through the views in 0007,
-- which contain no contact columns, and through the SECURITY DEFINER functions
-- in 0008, which return only what the caller is entitled to. Anon may INSERT
-- into donors and blood_requests and nothing else. Admins, checked against the
-- allowlist by is_admin(), may read and write everything.
--
-- If you are adding a table, the default is: enable RLS, add no anon policy,
-- and expose whatever the public genuinely needs through a view.
--
-- To sanity check this after running it, see the query at the bottom of the
-- file: it lists every table with RLS off, which should return zero rows.

-- ---------------------------------------------------------------------------
-- Turn RLS on everywhere. With RLS on and no policy, the table is closed.
-- ---------------------------------------------------------------------------
alter table public.donors             enable row level security;
alter table public.blood_requests     enable row level security;
alter table public.request_recipients enable row level security;
alter table public.email_queue        enable row level security;
alter table public.districts          enable row level security;
alter table public.upazilas           enable row level security;
alter table public.hospitals          enable row level security;
alter table public.geocode_cache      enable row level security;
alter table public.admin_settings     enable row level security;
alter table public.admins             enable row level security;
alter table public.audit_log          enable row level security;

-- Force RLS even for the table owner, so a mistake in a SECURITY DEFINER
-- function cannot quietly bypass the whole model.
alter table public.donors             force row level security;
alter table public.blood_requests     force row level security;
alter table public.request_recipients force row level security;

-- ---------------------------------------------------------------------------
-- donors
--
-- anon: INSERT only. Registration is open to the world; reading is not.
-- There is deliberately no anon SELECT policy, so `select * from donors`
-- returns zero rows no matter how the query is written.
-- ---------------------------------------------------------------------------
drop policy if exists donors_anon_insert on public.donors;
create policy donors_anon_insert on public.donors
  for insert to anon, authenticated
  with check (
    -- A registration cannot arrive pre-verified or pre-blocked, and cannot
    -- claim a donation history. Those are ours to set, not the visitor's.
    verified = false
    and blocked = false
    and total_donations = 0
  );

drop policy if exists donors_admin_all on public.donors;
create policy donors_admin_all on public.donors
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- blood_requests
--
-- anon: INSERT only, and the row must start life as 'open'. Nobody can create
-- a request that is already fulfilled, or backdate one.
-- ---------------------------------------------------------------------------
drop policy if exists blood_requests_anon_insert on public.blood_requests;
create policy blood_requests_anon_insert on public.blood_requests
  for insert to anon, authenticated
  with check (status = 'open');

drop policy if exists blood_requests_admin_all on public.blood_requests;
create policy blood_requests_admin_all on public.blood_requests
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- request_recipients
--
-- No anon access at all. Donors answer through respond_to_request(), which is
-- SECURITY DEFINER and checks the token. Letting anon read this table would
-- expose who was asked about which request.
-- ---------------------------------------------------------------------------
drop policy if exists request_recipients_admin_all on public.request_recipients;
create policy request_recipients_admin_all on public.request_recipients
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- email_queue
--
-- Contains rendered emails, which contain phone numbers. Admin only. The Edge
-- Functions reach it as service_role, which bypasses RLS by design.
-- ---------------------------------------------------------------------------
drop policy if exists email_queue_admin_all on public.email_queue;
create policy email_queue_admin_all on public.email_queue
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Reference data: districts, upazilas, hospitals
--
-- Public read. These are places, not people. Write is admin only.
-- ---------------------------------------------------------------------------
drop policy if exists districts_read on public.districts;
create policy districts_read on public.districts
  for select to anon, authenticated using (true);

drop policy if exists districts_admin_write on public.districts;
create policy districts_admin_write on public.districts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists upazilas_read on public.upazilas;
create policy upazilas_read on public.upazilas
  for select to anon, authenticated using (true);

drop policy if exists upazilas_admin_write on public.upazilas;
create policy upazilas_admin_write on public.upazilas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists hospitals_read on public.hospitals;
create policy hospitals_read on public.hospitals
  for select to anon, authenticated using (is_active);

drop policy if exists hospitals_admin_write on public.hospitals;
create policy hospitals_admin_write on public.hospitals
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- geocode_cache
--
-- No public access. A cache of resolved addresses is a record of where people
-- have been looking, which is worth protecting even though it holds no names.
-- Written by the geocode Edge Function as service_role.
-- ---------------------------------------------------------------------------
drop policy if exists geocode_cache_admin_all on public.geocode_cache;
create policy geocode_cache_admin_all on public.geocode_cache
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- admin_settings, admins, audit_log
-- ---------------------------------------------------------------------------
drop policy if exists admin_settings_admin_all on public.admin_settings;
create policy admin_settings_admin_all on public.admin_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- An admin may see the allowlist. Only an existing admin may change it.
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins
  for select to authenticated using (public.is_admin());

drop policy if exists admins_write on public.admins;
create policy admins_write on public.admins
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admins may read the audit log. Nobody may edit or delete it, including
-- admins: there is no UPDATE or DELETE policy, and that is intentional.
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Grants
--
-- RLS decides which rows. Grants decide which tables can be named at all.
-- Both are needed: revoking the grant means a mistake in a policy still fails
-- closed.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

grant select on public.districts, public.upazilas, public.hospitals to anon, authenticated;
grant insert on public.donors, public.blood_requests to anon, authenticated;

-- The views are the public API surface.
grant select on
  public.donors_public,
  public.wall_of_donors,
  public.public_stats,
  public.public_group_availability,
  public.hospitals_public
to anon, authenticated;

-- Sequences anon needs for its two inserts.
grant usage on all sequences in schema public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verify
--
-- Run these after applying. The first must return zero rows. The second must
-- show no contact columns.
--
--   select tablename from pg_tables t
--   where schemaname = 'public'
--     and not exists (
--       select 1 from pg_class c
--       where c.relname = t.tablename and c.relrowsecurity
--     );
--
--   select column_name from information_schema.columns
--   where table_name = 'donors_public';
--
-- And as a final check, from the browser with the anon key:
--   supabase.from('donors').select('phone')   -> must return no rows
-- ---------------------------------------------------------------------------

-- ==========================================================================
-- 20260811000010_locate_area.sql
-- ==========================================================================

-- 0011  Turning coordinates into a district and upazila
--
-- The brief called for reverse geocoding through Nominatim to auto-select the
-- district and upazila after "Locate me". We already seeded a centroid for
-- every district and nearly every upazila, so the nearest centroid answers
-- that question without leaving the database.
--
-- That is better here for four reasons:
--   - No third party learns the location of someone looking for blood.
--   - No rate limit, so it cannot fail during a rush.
--   - It answers in milliseconds on a slow phone connection.
--   - It cannot be down.
--
-- The limit, stated plainly: a centroid is not a boundary. Near the edge of an
-- upazila this can pick the neighbour. That is acceptable because the result
-- is a pre-filled dropdown the user can change, next to a pin they can drag,
-- and never a silent decision made on their behalf.
--
-- Nominatim still has a job: turning a point into a human-readable address
-- label. That needs a real User-Agent, which a browser cannot set, so it goes
-- through an Edge Function. It is a nicety, not a dependency, and it arrives
-- with the other functions.

create or replace function public.locate_area(
  in_lat double precision,
  in_lng double precision
)
returns table (
  district_id integer,
  district_en text,
  district_bn text,
  upazila_id integer,
  upazila_en text,
  upazila_bn text,
  district_distance_km double precision,
  upazila_distance_km double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with nearest_district as (
    select d.id, d.name_en, d.name_bn,
           public.haversine_km(in_lat, in_lng, d.lat, d.lng) as km
    from public.districts d
    order by km asc
    limit 1
  ),
  nearest_upazila as (
    -- Restricted to the chosen district so a point near a district border
    -- cannot end up with an upazila from a different district, which would
    -- produce a pair that does not exist.
    select u.id, u.name_en, u.name_bn,
           public.haversine_km(in_lat, in_lng, u.lat, u.lng) as km
    from public.upazilas u
    join nearest_district nd on nd.id = u.district_id
    where u.lat is not null and u.lng is not null
    order by km asc
    limit 1
  )
  select
    nd.id, nd.name_en, nd.name_bn,
    nu.id, nu.name_en, nu.name_bn,
    round(nd.km::numeric, 1)::double precision,
    round(nu.km::numeric, 1)::double precision
  from nearest_district nd
  left join nearest_upazila nu on true;
$$;

revoke all on function public.locate_area(double precision, double precision) from public;
grant execute on function public.locate_area(double precision, double precision) to anon, authenticated;

comment on function public.locate_area(double precision, double precision) is
  'Nearest seeded centroid. A hint for a dropdown the user can correct, not an authoritative boundary lookup.';

-- ==========================================================================
-- 20260811000011_matcher.sql
-- ==========================================================================

-- 0012  The expanding radius matcher
--
-- When someone asks for blood, this decides who hears about it.
--
-- It lives in the database rather than in the browser or an Edge Function for
-- three reasons. It needs to read donor rows, which nothing in a browser is
-- ever allowed to do. It must be one transaction, so a request can never end
-- up half-matched. And it has to work before the email pipeline exists, so
-- admins can send manually from day one.
--
-- What it returns to the caller is a count and a radius. Never a donor.

create or replace function public.run_request_matcher(in_request_id uuid)
returns table (
  matched_count integer,
  radius_km double precision,
  widened boolean,
  emails_queued boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  origin_lat double precision;
  origin_lng double precision;

  steps jsonb := public.get_setting('match_radius_steps', '[5, 10, 25, 50]'::jsonb);
  min_per_step integer := public.setting_int('min_donors_per_step', 10);
  max_emails integer := public.setting_int('max_emails_per_request', 25);
  cooldown integer := public.setting_int('donor_cooldown_days', 120);
  auto_email boolean := public.setting_bool('auto_email_enabled', false);

  chosen_radius double precision := null;
  step_value double precision;
  found integer := 0;
  used_district boolean := false;
  inserted integer := 0;
begin
  select * into req from public.blood_requests where id = in_request_id;
  if not found then
    raise exception 'request_not_found';
  end if;

  -- Only match a request that is still live. Re-running on a fulfilled request
  -- would email people about something that is already over.
  if req.status not in ('open', 'matched') then
    return query select 0, 0::double precision, false, false;
    return;
  end if;

  -- Prefer the exact point the requester gave. Fall back to the centre of
  -- their district, which is why district_id is required when there are no
  -- coordinates.
  select coalesce(req.lat, d.lat), coalesce(req.lng, d.lng)
  into origin_lat, origin_lng
  from public.districts d
  where d.id = req.district_id;

  if origin_lat is null then
    raise exception 'request_has_no_usable_location';
  end if;

  -- ---------------------------------------------------------------------
  -- Widen until there are enough people, then stop.
  --
  -- Starting wide would email someone 40km away when a neighbour could walk
  -- there, and every email spent on a distant donor is one the daily Gmail
  -- cap will not give back.
  -- ---------------------------------------------------------------------
  for step_value in select (jsonb_array_elements_text(steps))::double precision loop
    select count(*) into found
    from public.donors d
    where not d.blocked
      and d.consent_email
      and d.email is not null
      and d.blood_group = req.blood_group
      and d.lat is not null and d.lng is not null
      and (d.last_donation_date is null
           or d.last_donation_date + (cooldown || ' days')::interval <= now())
      and public.haversine_km(origin_lat, origin_lng, d.lat, d.lng) <= step_value;

    chosen_radius := step_value;
    exit when found >= min_per_step;
  end loop;

  -- Still not enough after the widest step: take the whole district. Better a
  -- long drive than nobody at all.
  if found < min_per_step and req.district_id is not null then
    select count(*) into found
    from public.donors d
    where not d.blocked
      and d.consent_email
      and d.email is not null
      and d.blood_group = req.blood_group
      and d.district_id = req.district_id
      and (d.last_donation_date is null
           or d.last_donation_date + (cooldown || ' days')::interval <= now());

    if found > 0 then
      used_district := true;
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Record who gets told.
  --
  -- The status written here is the master switch made visible: with
  -- auto_email_enabled off, matching still runs in full and every recipient is
  -- recorded as 'skipped', so an admin can look at exactly who would have been
  -- contacted and send by hand. Nothing is lost by leaving the switch off.
  -- ---------------------------------------------------------------------
  with candidates as (
    select
      d.id as donor_id,
      round(public.haversine_km(origin_lat, origin_lng, d.lat, d.lng)::numeric, 2) as km
    from public.donors d
    where not d.blocked
      and d.consent_email
      and d.email is not null
      and d.blood_group = req.blood_group
      and (d.last_donation_date is null
           or d.last_donation_date + (cooldown || ' days')::interval <= now())
      and (
        case
          when used_district then d.district_id = req.district_id
          else d.lat is not null
               and d.lng is not null
               and public.haversine_km(origin_lat, origin_lng, d.lat, d.lng) <= chosen_radius
        end
      )
      -- Never tell the same donor about the same request twice, which also
      -- makes this function safe to re-run.
      and not exists (
        select 1 from public.request_recipients rr
        where rr.request_id = in_request_id and rr.donor_id = d.id
      )
    order by km asc nulls last
    limit max_emails
  )
  insert into public.request_recipients (request_id, donor_id, distance_km, email_status)
  select in_request_id, donor_id, km,
         case when auto_email then 'queued' else 'skipped' end::public.email_status
  from candidates;

  get diagnostics inserted = row_count;

  update public.blood_requests
  set match_radius_km = case when used_district then null else chosen_radius::integer end,
      status = case when inserted > 0 then 'matched' else status end
  where id = in_request_id;

  return query select inserted, chosen_radius, used_district, auto_email;
end;
$$;

-- Anonymous callers may run the matcher for a request that already exists.
-- It reads donor rows but returns only a count and a radius, and the row it
-- writes is invisible to them.
revoke all on function public.run_request_matcher(uuid) from public;
grant execute on function public.run_request_matcher(uuid) to anon, authenticated;

comment on function public.run_request_matcher(uuid) is
  'Expanding radius match. Returns counts only, never donor rows. Safe to re-run.';

-- ---------------------------------------------------------------------------
-- What a requester may see about their own request
--
-- Keyed on the request id, which only they have. Returns aggregate progress so
-- the confirmation screen can say something true, and never a donor identity.
-- ---------------------------------------------------------------------------
create or replace function public.request_progress(in_request_id uuid)
returns table (
  status public.request_status,
  notified integer,
  accepted integer,
  declined integer,
  pending integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.status,
    count(rr.*)::integer,
    count(*) filter (where rr.response = 'accepted')::integer,
    count(*) filter (where rr.response = 'declined')::integer,
    count(*) filter (where rr.response = 'pending')::integer
  from public.blood_requests r
  left join public.request_recipients rr on rr.request_id = r.id
  where r.id = in_request_id
  group by r.status;
$$;

revoke all on function public.request_progress(uuid) from public;
grant execute on function public.request_progress(uuid) to anon, authenticated;

-- ==========================================================================
-- 20260811000012_email_pipeline.sql
-- ==========================================================================

-- 0013  What the email pipeline needs from the database
--
-- Two things: a way to never send the same email twice, and a way to hash a
-- caller's IP address without ever storing it.

-- ---------------------------------------------------------------------------
-- Idempotency
--
-- The queue is drained on a schedule and the sender can be called again after
-- a timeout, so "did I already write this one" has to be answered by the
-- database rather than by hoping. One email of each kind per recipient row.
-- ---------------------------------------------------------------------------
create unique index if not exists email_queue_recipient_kind_idx
  on public.email_queue (recipient_id, kind)
  where recipient_id is not null;

-- The requester's confirmation and each acceptance are keyed on the request.
-- Acceptances differ per donor, so they carry the recipient id too and are
-- covered by the index above.
create unique index if not exists email_queue_request_kind_idx
  on public.email_queue (request_id, kind)
  where recipient_id is null and request_id is not null;

-- ---------------------------------------------------------------------------
-- Hashing a caller's IP
--
-- Raw addresses are never stored. The Edge Function passes the address in, and
-- this salts and hashes it so that a leak of donors or blood_requests cannot
-- be used to work out who was searching for blood.
--
-- The salt lives in a database setting, not in the repo. Set it once with:
--
--   alter database postgres set app.ip_salt = 'some long random string';
--
-- If it is unset the function still works, but the hashes are only as good as
-- the fixed fallback, so set it.
-- ---------------------------------------------------------------------------
create or replace function public.hash_ip(in_ip text)
returns text
language plpgsql
stable
as $$
declare
  salt text;
begin
  if in_ip is null or btrim(in_ip) = '' then
    return null;
  end if;

  begin
    salt := current_setting('app.ip_salt');
  exception
    when others then
      salt := 'roktolagbe-unsalted-please-set-app.ip_salt';
  end;

  return encode(digest(salt || '|' || btrim(in_ip), 'sha256'), 'hex');
end;
$$;

revoke all on function public.hash_ip(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rate limiting from the Edge Function
--
-- The triggers in 0008 only fire on INSERT, and a browser cannot see its own
-- public address, so until now ip_hash was always null and the cap never
-- applied. The Edge Function calls this BEFORE it does any work, with the
-- address it can see, and stamps the row afterwards.
--
-- Returns true when the caller is within the cap.
-- ---------------------------------------------------------------------------
create or replace function public.check_and_record_ip(
  in_ip text,
  in_kind text,
  in_target_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hashed text := public.hash_ip(in_ip);
  recent integer;
  cap integer;
begin
  if hashed is null then
    return true; -- nothing to key on; the honeypot and timing checks stand
  end if;

  if in_kind = 'request' then
    cap := public.setting_int('max_requests_per_ip_per_hour', 3);
    select count(*) into recent
    from public.blood_requests
    where ip_hash = hashed
      and created_at > now() - interval '1 hour'
      and id <> in_target_id;

    if recent >= cap then
      return false;
    end if;

    update public.blood_requests set ip_hash = hashed where id = in_target_id;
  else
    cap := public.setting_int('max_registrations_per_ip_per_hour', 3);
    select count(*) into recent
    from public.donors
    where ip_hash = hashed
      and created_at > now() - interval '1 hour'
      and id <> in_target_id;

    if recent >= cap then
      return false;
    end if;

    update public.donors set ip_hash = hashed where id = in_target_id;
  end if;

  return true;
end;
$$;

revoke all on function public.check_and_record_ip(text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Everything the donor email needs, in one row
--
-- The Edge Function runs as service_role and could read the tables directly,
-- but a single function keeps the shape of a donor email in one reviewable
-- place, next to the rules about what may go in it.
-- ---------------------------------------------------------------------------
create or replace function public.pending_donor_emails(in_request_id uuid, in_limit integer)
returns table (
  recipient_id uuid,
  donor_email citext,
  donor_name text,
  opt_out_token uuid,
  response_token uuid,
  distance_km numeric,
  blood_group public.blood_group,
  units_needed integer,
  urgency public.urgency_level,
  hospital_name text,
  district_name text,
  needed_by timestamptz,
  patient_note text,
  requester_name text,
  request_lat double precision,
  request_lng double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rr.id,
    d.email,
    d.display_name,
    d.opt_out_token,
    rr.response_token,
    rr.distance_km,
    r.blood_group,
    r.units_needed,
    r.urgency,
    coalesce(h.name_en, r.hospital_name_free_text),
    dis.name_en,
    r.needed_by,
    r.patient_note,
    r.requester_name,
    coalesce(r.lat, h.lat, dis.lat),
    coalesce(r.lng, h.lng, dis.lng)
  from public.request_recipients rr
  join public.blood_requests r on r.id = rr.request_id
  join public.donors d on d.id = rr.donor_id
  left join public.hospitals h on h.id = r.hospital_id
  left join public.districts dis on dis.id = r.district_id
  where rr.request_id = in_request_id
    and rr.email_status = 'queued'
    and d.email is not null
    and d.consent_email
    and not d.blocked
    -- Nothing already written to the queue for this recipient.
    and not exists (
      select 1 from public.email_queue q
      where q.recipient_id = rr.id and q.kind = 'donor_request'
    )
  limit in_limit;
$$;

revoke all on function public.pending_donor_emails(uuid, integer) from public, anon, authenticated;

-- Contact details for one acceptance, for the email that goes back to the
-- requester. This is the single point at which a donor's number leaves.
create or replace function public.acceptance_details(in_recipient_id uuid)
returns table (
  request_id uuid,
  requester_email citext,
  requester_name text,
  donor_name text,
  donor_phone text,
  donor_whatsapp text,
  donor_district text,
  distance_km numeric,
  blood_group public.blood_group
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.requester_email,
    r.requester_name,
    d.display_name,
    d.phone,
    d.whatsapp,
    dis.name_en,
    rr.distance_km,
    d.blood_group
  from public.request_recipients rr
  join public.blood_requests r on r.id = rr.request_id
  join public.donors d on d.id = rr.donor_id
  left join public.districts dis on dis.id = d.district_id
  where rr.id = in_recipient_id
    and rr.response = 'accepted';
$$;

revoke all on function public.acceptance_details(uuid) from public, anon, authenticated;

-- ==========================================================================
-- 20260811000013_admin.sql
-- ==========================================================================

-- 0014  What the admin panel needs
--
-- Every function here is admin-only and writes to audit_log. An admin can see
-- contact details, because verifying and unblocking people requires it, and
-- that is exactly why every one of these actions leaves a trace nobody can
-- edit or delete.

-- Soft delete. A donor row is never really removed: their donation history is
-- part of other people's records, and a hard delete would let the same phone
-- number register again as if new.
alter table public.donors add column if not exists deleted_at timestamptz;
alter table public.donors add column if not exists admin_note text;

create index if not exists donors_not_deleted_idx on public.donors (created_at desc)
  where deleted_at is null;

-- The public views must never show a deleted donor.
drop view if exists public.donors_public cascade;
create view public.donors_public as
select
  d.id, d.display_name, d.blood_group,
  d.district_id, du.name_en as district_en, du.name_bn as district_bn,
  d.upazila_id, u.name_en as upazila_en, u.name_bn as upazila_bn,
  d.lat_fuzzed, d.lng_fuzzed,
  d.verified, d.total_donations,
  (d.last_donation_date is null
    or d.last_donation_date + (public.setting_int('donor_cooldown_days', 120) || ' days')::interval <= now()
  ) as is_available,
  to_char(d.last_donation_date, 'YYYY-MM') as last_donation_month
from public.donors d
left join public.districts du on du.id = d.district_id
left join public.upazilas u on u.id = d.upazila_id
where not d.blocked and d.deleted_at is null and d.consent_public_listing;

drop view if exists public.wall_of_donors cascade;
create view public.wall_of_donors as
select d.id, d.display_name, d.blood_group,
       du.name_en as district_en, du.name_bn as district_bn,
       d.total_donations, d.verified,
       date_trunc('month', d.created_at)::date as joined_month
from public.donors d
left join public.districts du on du.id = d.district_id
where d.consent_public_listing and not d.blocked and d.deleted_at is null
order by d.total_donations desc, d.created_at asc;

drop view if exists public.public_stats cascade;
create view public.public_stats as
select 'donors_total' as metric, count(*)::bigint as value
from public.donors where not blocked and deleted_at is null
union all
select 'requests_fulfilled', count(*)::bigint from public.blood_requests where status = 'fulfilled'
union all
select 'districts_covered', count(distinct district_id)::bigint
from public.donors where not blocked and deleted_at is null and district_id is not null;

drop view if exists public.public_group_availability cascade;
create view public.public_group_availability as
select d.blood_group,
  count(*) filter (
    where d.last_donation_date is null
       or d.last_donation_date + (public.setting_int('donor_cooldown_days', 120) || ' days')::interval <= now()
  )::bigint as available,
  count(*)::bigint as total
from public.donors d
where not d.blocked and d.deleted_at is null
group by d.blood_group;

grant select on public.donors_public, public.wall_of_donors,
                public.public_stats, public.public_group_availability
to anon, authenticated;

-- Matching must skip deleted donors too.
create or replace function public.match_donors_for_request(
  in_request_id uuid, in_radius_km double precision, in_max_results integer
)
returns table (donor_id uuid, email citext, distance_km double precision)
language sql stable security definer set search_path = public
as $$
  with req as (
    select r.*, coalesce(r.lat, dis.lat) as origin_lat, coalesce(r.lng, dis.lng) as origin_lng
    from public.blood_requests r
    left join public.districts dis on dis.id = r.district_id
    where r.id = in_request_id
  ), cooldown as (select public.setting_int('donor_cooldown_days', 120) as days)
  select d.id, d.email,
         round(public.haversine_km(req.origin_lat, req.origin_lng, d.lat, d.lng)::numeric, 1)::double precision
  from public.donors d cross join req cross join cooldown c
  where not d.blocked and d.deleted_at is null and d.consent_email and d.email is not null
    and d.blood_group = req.blood_group and d.lat is not null and d.lng is not null
    and (d.last_donation_date is null
         or d.last_donation_date + (c.days || ' days')::interval <= now())
    and public.haversine_km(req.origin_lat, req.origin_lng, d.lat, d.lng) <= in_radius_km
    and not exists (select 1 from public.request_recipients rr
                    where rr.request_id = in_request_id and rr.donor_id = d.id)
  order by public.haversine_km(req.origin_lat, req.origin_lng, d.lat, d.lng) asc
  limit greatest(coalesce(in_max_results, 25), 0);
$$;
revoke all on function public.match_donors_for_request(uuid, double precision, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_authorised';
  end if;

  select jsonb_build_object(
    'donors_total', (select count(*) from public.donors where deleted_at is null),
    'donors_blocked', (select count(*) from public.donors where blocked and deleted_at is null),
    'donors_verified', (select count(*) from public.donors where verified and deleted_at is null),
    'requests_open', (select count(*) from public.blood_requests where status in ('open','matched')),
    'requests_fulfilled', (select count(*) from public.blood_requests where status = 'fulfilled'),
    'emails_queued', (select count(*) from public.email_queue where status = 'queued'),
    'emails_failed', (select count(*) from public.email_queue where status = 'failed'),
    'emails_sent_today', (select count(*) from public.email_queue
                          where status = 'sent' and sent_at > date_trunc('day', now())),
    'quota_remaining', public.email_quota_remaining(),
    'auto_email_enabled', public.setting_bool('auto_email_enabled', false),

    -- Requests over time: 30 days, zero-filled so the line has no gaps.
    'requests_over_time', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'count', c) order by d), '[]'::jsonb)
      from (
        select gs::date as d,
               (select count(*) from public.blood_requests r
                where r.created_at >= gs and r.created_at < gs + interval '1 day') as c
        from generate_series(date_trunc('day', now()) - interval '29 days',
                             date_trunc('day', now()), interval '1 day') gs
      ) s
    ),

    'by_group', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'blood_group', g.blood_group, 'available', g.available, 'total', g.total)), '[]'::jsonb)
      from public.public_group_availability g
    ),

    'by_district', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select dis.name_en as district, count(*) as donors
        from public.donors d join public.districts dis on dis.id = d.district_id
        where d.deleted_at is null and not d.blocked
        group by dis.name_en order by count(*) desc limit 12
      ) x
    )
  ) into result;

  return result;
end;
$$;
revoke all on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin actions. Each one checks is_admin() itself and writes an audit row.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_donor(
  in_donor_id uuid,
  in_verified boolean default null,
  in_blocked boolean default null,
  in_deleted boolean default null,
  in_note text default null
)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not_authorised'; end if;

  update public.donors set
    verified   = coalesce(in_verified, verified),
    blocked    = coalesce(in_blocked, blocked),
    deleted_at = case when in_deleted is null then deleted_at
                      when in_deleted then coalesce(deleted_at, now())
                      else null end,
    admin_note = coalesce(in_note, admin_note)
  where id = in_donor_id;

  perform public.write_audit('donor.update', 'donors', in_donor_id::text,
    jsonb_build_object('verified', in_verified, 'blocked', in_blocked,
                       'deleted', in_deleted, 'note', in_note));
  return true;
end;
$$;
revoke all on function public.admin_update_donor(uuid, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.admin_update_donor(uuid, boolean, boolean, boolean, text) to authenticated;

create or replace function public.admin_update_request(in_request_id uuid, in_status public.request_status)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not_authorised'; end if;
  update public.blood_requests set status = in_status where id = in_request_id;

  -- Marking a request fulfilled is what starts the cooldown for the donors who
  -- actually accepted. Accepting is a promise; this is the donation.
  if in_status = 'fulfilled' then
    update public.donors d set
      last_donation_date = current_date,
      total_donations = total_donations + 1
    from public.request_recipients rr
    where rr.request_id = in_request_id and rr.response = 'accepted' and rr.donor_id = d.id;
  end if;

  perform public.write_audit('request.status', 'blood_requests', in_request_id::text,
                             jsonb_build_object('status', in_status));
  return true;
end;
$$;
revoke all on function public.admin_update_request(uuid, public.request_status) from public, anon;
grant execute on function public.admin_update_request(uuid, public.request_status) to authenticated;

-- Put a failed email back in the queue.
create or replace function public.admin_retry_email(in_email_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not_authorised'; end if;
  update public.email_queue
  set status = 'queued', attempts = 0, last_error = null, scheduled_for = now()
  where id = in_email_id;
  perform public.write_audit('email.retry', 'email_queue', in_email_id::text, '{}'::jsonb);
  return true;
end;
$$;
revoke all on function public.admin_retry_email(uuid) from public, anon;
grant execute on function public.admin_retry_email(uuid) to authenticated;

create or replace function public.admin_set_setting(in_key text, in_value jsonb)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not_authorised'; end if;
  insert into public.admin_settings (key, value, updated_by)
  values (in_key, in_value, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  perform public.write_audit('setting.update', 'admin_settings', in_key,
                             jsonb_build_object('value', in_value));
  return true;
end;
$$;
revoke all on function public.admin_set_setting(text, jsonb) from public, anon;
grant execute on function public.admin_set_setting(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin reads. RLS already restricts these tables to admins, so the panel can
-- select from them directly; these two exist because they join across tables.
-- ---------------------------------------------------------------------------
create or replace function public.admin_request_recipients(in_request_id uuid)
returns table (
  recipient_id uuid, donor_name text, donor_phone text, donor_email citext,
  blood_group public.blood_group, distance_km numeric,
  email_status public.email_status, response public.response_status,
  sent_at timestamptz, responded_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select rr.id, d.display_name, d.phone, d.email, d.blood_group, rr.distance_km,
         rr.email_status, rr.response, rr.sent_at, rr.responded_at
  from public.request_recipients rr
  join public.donors d on d.id = rr.donor_id
  where rr.request_id = in_request_id and public.is_admin()
  order by rr.distance_km asc nulls last;
$$;
revoke all on function public.admin_request_recipients(uuid) from public, anon;
grant execute on function public.admin_request_recipients(uuid) to authenticated;

commit;
