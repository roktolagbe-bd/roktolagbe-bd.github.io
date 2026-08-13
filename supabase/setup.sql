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
-- SUPERSEDED BY 0016. Do not copy this approach. `alter database postgres set`
-- is rejected on hosted Supabase, and the fallback below silently produced
-- hashes anyone could reproduce from this file. Both the salt and the hashing
-- now live in the Edge Function; 0016 drops hash_ip entirely. Kept here only
-- because migrations are history and rewriting them would break replay.
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

-- ==========================================================================
-- 20260811000014_geocode_cache_rpc.sql
-- ==========================================================================

-- 0014  Serving and filling the geocode cache
--
-- The geocode Edge Function is the only thing allowed to talk to Nominatim,
-- because a browser cannot set a User-Agent and OSM's usage policy requires
-- one. These two functions are how it reads and writes the cache.
--
-- Everything is keyed on coordinates rounded to three decimals, roughly 110
-- metres. That is deliberately coarse: it means two people in the same street
-- share a cache entry, which cuts requests to OSM enormously, and it means the
-- cache itself is not a record of anyone's exact position.

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------
create or replace function public.geocode_lookup(
  in_lat double precision,
  in_lng double precision
)
returns table (
  display_name text,
  area_label text,
  district_id integer,
  upazila_id integer,
  cached_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.display_name,
    g.raw ->> 'area_label',
    g.district_id,
    g.upazila_id,
    g.created_at
  from public.geocode_cache g
  where g.lat_key = round(in_lat::numeric, 3)
    and g.lng_key = round(in_lng::numeric, 3)
  limit 1;
$$;

-- Anon may READ the cache. It contains place names, not people: an entry says
-- "this 110m square is called Gulshan", which is true of the square whether
-- anyone stood in it or not. Writing is service_role only.
revoke all on function public.geocode_lookup(double precision, double precision) from public;
grant execute on function public.geocode_lookup(double precision, double precision) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Write
-- ---------------------------------------------------------------------------
create or replace function public.geocode_store(
  in_lat double precision,
  in_lng double precision,
  in_display_name text,
  in_area_label text,
  in_district_id integer,
  in_upazila_id integer,
  in_raw jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.geocode_cache (lat_key, lng_key, display_name, district_id, upazila_id, raw)
  values (
    round(in_lat::numeric, 3),
    round(in_lng::numeric, 3),
    in_display_name,
    in_district_id,
    in_upazila_id,
    coalesce(in_raw, '{}'::jsonb) || jsonb_build_object('area_label', in_area_label)
  )
  on conflict (lat_key, lng_key) do update set
    display_name = excluded.display_name,
    district_id  = coalesce(excluded.district_id, public.geocode_cache.district_id),
    upazila_id   = coalesce(excluded.upazila_id, public.geocode_cache.upazila_id),
    raw          = excluded.raw;
$$;

revoke all on function public.geocode_store(double precision, double precision, text, text, integer, integer, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Matching a name from OSM to one of our districts
--
-- OSM spells things its own way, and differently again in Bangla. This tries
-- exact, then case-insensitive, then the same transliteration slips the seed
-- generator had to handle: Jessore/Jashore, Comilla/Cumilla, Chittagong.
-- ---------------------------------------------------------------------------
create or replace function public.district_by_name(in_name text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with needle as (
    select regexp_replace(
      lower(coalesce(in_name, '')),
      '(district|zila|jela|\s|-)', '', 'g'
    ) as n
  ),
  normalised as (
    select d.id,
           regexp_replace(lower(d.name_en), '(district|zila|jela|\s|-)', '', 'g') as en,
           replace(d.name_bn, ' ', '') as bn
    from public.districts d
  )
  select id from normalised, needle
  where en = n
     or bn = in_name
     or en = replace(replace(replace(replace(n,
          'jessore', 'jashore'),
          'comilla', 'cumilla'),
          'chittagong', 'chattogram'),
          'barisal', 'barishal')
  limit 1;
$$;

revoke all on function public.district_by_name(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Politeness towards OpenStreetMap
--
-- Their usage policy asks for no more than one request per second. Edge
-- Function instances do not share memory, so the only place that can hold a
-- global rate limit is the database. This claims a slot and returns false if
-- one was taken too recently; the function then serves whatever it has rather
-- than queueing up behind a volunteer-funded service.
-- ---------------------------------------------------------------------------
create table if not exists public.geocode_throttle (
  id boolean primary key default true,
  last_call_at timestamptz not null default to_timestamp(0),
  constraint geocode_throttle_single_row check (id)
);

insert into public.geocode_throttle (id) values (true) on conflict do nothing;

alter table public.geocode_throttle enable row level security;

create or replace function public.geocode_claim_slot(in_min_interval_ms integer default 1100)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  -- A conditional UPDATE is the whole lock: only one caller can move the
  -- timestamp forward, and everyone else sees zero rows updated.
  update public.geocode_throttle
  set last_call_at = now()
  where id
    and last_call_at < now() - make_interval(secs => in_min_interval_ms / 1000.0)
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.geocode_claim_slot(integer) from public, anon, authenticated;

-- ==========================================================================
-- 20260811000015_area_name.sql
-- ==========================================================================

-- 0015  A public area name, and an upazila nobody has to think about
--
-- Two things were wrong with the location step, and they were the same thing
-- seen from two sides.
--
-- The upazila dropdown asked every donor a question that has no answer in the
-- place most of them live. Central Dhaka is thanas, not upazilas, so someone
-- in Gulshan was shown a list containing Dhamrai, Dohar, Keraniganj, Nawabganj
-- and Savar and asked to pick. There is no right choice there, and being asked
-- implies there is one.
--
-- Meanwhile the only public name a donor had WAS the upazila. So the same
-- people who could not answer the question also ended up with no area at all
-- in search results: just "Dhaka", for a city of twenty million.
--
-- So: the upazila stops being a question and becomes a derivation, and the
-- public area becomes its own field, filled in from the geocoder and editable.
--
--   district_id  public, chosen        ->  ঢাকা
--   area_name    public, auto-filled   ->  গুলশান-১
--   address_line PRIVATE, never shown  ->  house and road
--   upazila_id   public, derived from the point, never asked
--
-- address_line's rule does not change and is not negotiable: it is released to
-- one requester after the donor accepts them, and appears in no view.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
alter table public.donors
  add column if not exists area_name text;

-- 60 characters is enough for any neighbourhood in the country and far too
-- few for a street address. The limit is the point: this column is public, so
-- the schema should make it awkward to put a doorstep in it.
alter table public.donors drop constraint if exists donors_area_name_length;
alter table public.donors add constraint donors_area_name_length
  check (area_name is null or char_length(btrim(area_name)) between 1 and 60);

comment on column public.donors.area_name is
  'PUBLIC. Neighbourhood name only, e.g. "Gulshan 1". Never a street address; that is address_line.';

-- Deliberately not backfilled from upazilas. A null area_name means "no name
-- of its own", and the views leave it null so the reader can fall back to the
-- upazila in whichever language they are reading. Copying one language's
-- upazila name in here would freeze that choice forever.

-- ---------------------------------------------------------------------------
-- Deriving the upazila from the point
--
-- The form no longer asks, so the database works it out. Same 8km confidence
-- rule the client used to apply, and for the same reason: beyond that the
-- nearest centroid is a guess dressed up as an answer. Inside Dhaka nothing is
-- within 8km, so it stays null, which is the honest result.
--
-- Kept in step with UPAZILA_CONFIDENCE_KM in src/lib/places.ts.
-- ---------------------------------------------------------------------------
create or replace function public.donors_apply_fuzz()
returns trigger
language plpgsql
as $$
declare
  fuzzed record;
  moved boolean;
begin
  moved := tg_op = 'INSERT'
        or new.lat is distinct from old.lat
        or new.lng is distinct from old.lng;

  -- Only recompute when the true point actually moved, so the published point
  -- stays put across unrelated edits.
  if moved then
    select * into fuzzed from public.fuzz_point(new.lat, new.lng);
    new.lat_fuzzed := fuzzed.out_lat;
    new.lng_fuzzed := fuzzed.out_lng;
  end if;

  -- Derive the upazila when the point is new and nothing supplied one. Guarded
  -- by `moved` so an admin who deliberately clears the field on an unrelated
  -- edit does not have it silently filled back in.
  if moved and new.upazila_id is null
     and new.lat is not null and new.lng is not null then
    select la.upazila_id into new.upazila_id
    from public.locate_area(new.lat, new.lng) la
    where la.upazila_id is not null
      and la.upazila_distance_km is not null
      and la.upazila_distance_km <= 8;
  end if;

  -- Whitespace-only is the same as absent, and an empty string would show up
  -- in search results as a stray comma.
  if btrim(coalesce(new.area_name, '')) = '' then
    new.area_name := null;
  else
    new.area_name := btrim(new.area_name);
  end if;

  -- A donor who never chose a display name should not have their full legal
  -- name published by default.
  if new.display_name is null or btrim(new.display_name) = '' then
    new.display_name := split_part(btrim(new.full_name), ' ', 1);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Show it to the public
--
-- Dropped and recreated rather than replaced: `create or replace view` cannot
-- reorder columns, and area_name belongs next to the district it qualifies.
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
  d.area_name,
  d.upazila_id,
  u.name_en as upazila_en,
  u.name_bn as upazila_bn,

  -- The fuzzed point only. The true one never appears in a view.
  d.lat_fuzzed,
  d.lng_fuzzed,

  d.verified,
  d.total_donations,

  (
    d.last_donation_date is null
    or d.last_donation_date + (public.setting_int('donor_cooldown_days', 120) || ' days')::interval
       <= now()
  ) as is_available,

  to_char(d.last_donation_date, 'YYYY-MM') as last_donation_month
from public.donors d
left join public.districts du on du.id = d.district_id
left join public.upazilas u on u.id = d.upazila_id
where not d.blocked
  and d.deleted_at is null
  and d.consent_public_listing;

grant select on public.donors_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- And in proximity search
--
-- This also fixes something unrelated that was sitting here. 0013 added soft
-- delete and taught donors_public about it, but nearby_donors was never
-- updated, so a deleted donor still came back from a map search. The extra
-- `deleted_at is null` below closes that.
-- ---------------------------------------------------------------------------
drop function if exists public.nearby_donors(public.blood_group, double precision, double precision, double precision, integer);

create function public.nearby_donors(
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
  area_name text,
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
    d.area_name,
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
    and d.deleted_at is null
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

-- Admins need nothing here: the panel reads public.donors directly through the
-- admin RLS policy with `select *`, so area_name arrives on its own.

-- ==========================================================================
-- 20260811000016_ip_hash_in_function.sql
-- ==========================================================================

-- 0016  Hash the caller's IP before it reaches the database
--
-- The salt used to live in a database setting:
--
--   alter database postgres set app.ip_salt = '...'
--
-- That cannot work on hosted Supabase. The `postgres` role there is not the
-- database owner, so ALTER DATABASE ... SET fails with
--
--   ERROR: 42501: permission denied to set parameter
--
-- at every plan level. It is not a quota, it is the shape of the platform, and
-- no amount of paying changes it.
--
-- Worse, the old hash_ip() swallowed the failure. current_setting() raises
-- when the setting is absent, the exception handler caught it, and the
-- function carried on with a fallback salt written in plain text in this
-- repository. So the hashes looked salted and were not: anyone holding a dump
-- of donors or blood_requests could reproduce them from a public constant and
-- walk the whole IPv4 space in about an hour on one core.
--
-- So the salt moves to where secrets on this platform actually live, an Edge
-- Function secret named IP_SALT, and the hashing moves with it.
--
-- That turns out to be the better design anyway. The raw address now never
-- reaches Postgres at all: the function hashes it and passes the digest. There
-- is no longer any code path, trigger, log line or `select` that could put a
-- caller's IP address in the database, which is a stronger promise than "we
-- hash it on arrival".

-- ---------------------------------------------------------------------------
-- hash_ip is gone
--
-- Dropped rather than left in place. A function that takes a raw IP address is
-- an invitation to pass one, and there is nothing left that should.
-- ---------------------------------------------------------------------------
drop function if exists public.hash_ip(text);

-- ---------------------------------------------------------------------------
-- The rate limit now takes a digest, not an address
-- ---------------------------------------------------------------------------
drop function if exists public.check_and_record_ip(text, text, uuid);

create function public.check_and_record_ip(
  in_ip_hash text,
  in_kind text,
  in_target_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hashed text := nullif(btrim(coalesce(in_ip_hash, '')), '');
  recent integer;
  cap integer;
begin
  -- No digest means the function could not produce one, which today means
  -- IP_SALT is unset. Nothing to key on, so the honeypot and the time-on-page
  -- check stand alone. Deliberately not an error: a missing salt should not
  -- stop somebody asking for blood.
  if hashed is null then
    return true;
  end if;

  -- Refuse anything that is not a SHA-256 digest. This is the boundary where
  -- a raw address would show up if some future caller passed one by mistake,
  -- and it is much better to drop it here than to store it in ip_hash.
  if hashed !~ '^[0-9a-f]{64}$' then
    raise warning 'check_and_record_ip: expected a sha256 hex digest, refusing to store the value given';
    return true;
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

comment on function public.check_and_record_ip(text, text, uuid) is
  'Takes a SHA-256 hex digest of the caller IP, never the address. Salting and hashing happen in the Edge Function, using the IP_SALT secret.';

-- ---------------------------------------------------------------------------
-- Old hashes are not worth keeping
--
-- Every ip_hash written before this migration was computed with the fallback
-- salt printed in the repository, so each one is a reversible record of a real
-- person's address. They cannot be re-hashed, because the input is gone, and
-- they are useless for rate limiting once the salt changes. Clearing them is
-- the only option that leaves nothing behind.
-- ---------------------------------------------------------------------------
update public.donors set ip_hash = null where ip_hash is not null;
update public.blood_requests set ip_hash = null where ip_hash is not null;

-- ==========================================================================
-- 20260811000017_certificate.sql
-- ==========================================================================

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

-- ==========================================================================
-- 20260811000018_matcher_found_shadow.sql
-- ==========================================================================

-- 0018  The matcher never ran
--
-- Every blood request since the matcher was written has failed to match
-- anybody, and told the requester "no one found right now" while doing it.
-- Not because nobody was near: because the function raised on its second
-- statement, every single time.
--
--   ERROR: argument of NOT must be type boolean, not type integer
--   CONTEXT: run_request_matcher(uuid) line 20 at IF
--
-- 0011 declared `found integer := 0` as a counter. PL/pgSQL already has a
-- built-in variable called FOUND, a boolean set after every query, and a local
-- declaration shadows it. So the guard immediately below the first SELECT,
--
--   if not found then raise exception 'request_not_found'; end if;
--
-- was asking for `not 0`, which is a type error, not a false. The exception
-- propagated to the Edge Function, the Edge Function reported failure, the
-- browser fell back to calling the matcher directly, that raised too, and the
-- caller ended up with match: null. Zero and "it exploded" reach the requester
-- as the same sentence, which is why this survived a phase review, a live
-- deployment and several rounds of testing without being spotted.
--
-- Renamed to donor_count, and the existence check now looks at the record
-- itself rather than at a variable whose name was doing two jobs.
--
-- Also adds the soft-delete filter, which 0013 gave to donors_public and
-- match_donors_for_request but never to this function. Deleted donors were
-- being matched and recorded as recipients.

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
  -- Named donor_count, not found. FOUND is PL/pgSQL's own boolean and
  -- declaring it here is what broke this function for its entire life.
  donor_count integer := 0;
  used_district boolean := false;
  inserted integer := 0;
begin
  select * into req from public.blood_requests where id = in_request_id;
  if req.id is null then
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
    select count(*) into donor_count
    from public.donors d
    where not d.blocked
      and d.deleted_at is null
      and d.consent_email
      and d.email is not null
      and d.blood_group = req.blood_group
      and d.lat is not null and d.lng is not null
      and (d.last_donation_date is null
           or d.last_donation_date + (cooldown || ' days')::interval <= now())
      and public.haversine_km(origin_lat, origin_lng, d.lat, d.lng) <= step_value;

    chosen_radius := step_value;
    exit when donor_count >= min_per_step;
  end loop;

  -- Still not enough after the widest step: take the whole district. Better a
  -- long drive than nobody at all.
  if donor_count < min_per_step and req.district_id is not null then
    select count(*) into donor_count
    from public.donors d
    where not d.blocked
      and d.deleted_at is null
      and d.consent_email
      and d.email is not null
      and d.blood_group = req.blood_group
      and d.district_id = req.district_id
      and (d.last_donation_date is null
           or d.last_donation_date + (cooldown || ' days')::interval <= now());

    if donor_count > 0 then
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
      and d.deleted_at is null
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

revoke all on function public.run_request_matcher(uuid) from public;
grant execute on function public.run_request_matcher(uuid) to anon, authenticated;

comment on function public.run_request_matcher(uuid) is
  'Expanding radius match. Returns counts only, never donor rows. Safe to re-run.';

-- ---------------------------------------------------------------------------
-- How many donors were near but unreachable
--
-- The matcher can only contact a donor it can email, so a donor with no
-- address is invisible to it. That is correct — there is no way to tell them
-- about a request — but "nobody is near you" and "three people are near you
-- and none left an email address" are very different facts, and the requester
-- was being told the first when the second was true.
--
-- Admin-only. It returns a count, never a person.
-- ---------------------------------------------------------------------------
create or replace function public.unreachable_donors_near(in_request_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.blood_requests r
  left join public.districts dis on dis.id = r.district_id
  join public.donors d
    on d.blood_group = r.blood_group
   and not d.blocked
   and d.deleted_at is null
   and (d.email is null or not d.consent_email)
   and (
     d.district_id = r.district_id
     or (d.lat is not null and d.lng is not null
         and public.haversine_km(coalesce(r.lat, dis.lat), coalesce(r.lng, dis.lng), d.lat, d.lng) <= 50)
   )
  where r.id = in_request_id;
$$;

revoke all on function public.unreachable_donors_near(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- match_radius_km has to be allowed to be null
--
-- A second bug, which the first one was hiding. 0004 declared the column
-- `integer not null default 5`, but the matcher writes NULL into it to mean
-- "no radius applied, this went out to the whole district":
--
--   set match_radius_km = case when used_district then null else ... end
--
-- So every request that falls through to the district fallback — which is
-- every request on a site with fewer than min_donors_per_step donors nearby,
-- meaning very nearly all of them today — failed on a not-null violation the
-- moment the matcher got far enough to try.
--
-- Nobody saw it because the shadowed FOUND raised first, on line 20, long
-- before execution ever reached line 132. Fixing one exposed the other.
--
-- Null is the right value here: it is the absence of a radius, not a radius of
-- zero, and the reader in the admin panel already treats it as "whole
-- district". So the column changes, not the matcher.
-- ---------------------------------------------------------------------------
alter table public.blood_requests alter column match_radius_km drop not null;

comment on column public.blood_requests.match_radius_km is
  'The radius the matcher settled on, in km. NULL means the request went out to the whole district instead.';

-- ==========================================================================
-- 20260811000019_expire_old_requests.sql
-- ==========================================================================

-- 0019  Expiring requests without depending on pg_cron
--
-- There are two ways to drain the email queue, pg_cron or the GitHub Actions
-- workflow, and the project has always said to pick one. What it did not say
-- is that they were never equivalent: supabase/optional/cron_schedule.sql
-- schedules TWO jobs, the drain and an hourly sweep that marks requests
-- 'expired' once their needed_by has passed. The workflow only ever did the
-- first.
--
-- So anyone choosing the workflow — the option that needs no extensions, and
-- therefore the one most people will choose — silently got no expiry at all.
-- Requests for blood that was needed last Tuesday stay 'open' forever, the
-- landing page counts them, and the admin queue fills with things nobody can
-- act on.
--
-- Putting the sweep in a function fixes that for both paths. The drain
-- function calls it on every run, so expiry happens on whatever schedule the
-- drainer runs on, and pg_cron's separate hourly job becomes harmless
-- duplication rather than the only thing keeping the data honest.
--
-- Idempotent by construction: it only touches rows that are still open and
-- already past their deadline, so running it every five minutes costs an index
-- scan and changes nothing on the runs where there is nothing to change.

create or replace function public.expire_old_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer;
begin
  update public.blood_requests
  set status = 'expired'
  where status in ('open', 'matched')
    and needed_by is not null
    -- Six hours of grace. A request needed at 9am is not stale at 9:01, and
    -- somebody may still be on their way.
    and needed_by < now() - interval '6 hours';

  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

-- service_role only. It is a maintenance sweep, not something a visitor has
-- any business triggering.
revoke all on function public.expire_old_requests() from public, anon, authenticated;

comment on function public.expire_old_requests() is
  'Marks open requests expired six hours past needed_by. Called by drain-email-queue on every run, so it does not depend on pg_cron.';

-- Requests without a needed_by are deliberately left alone. "I need blood" with
-- no deadline is not a thing that goes stale on a timer, and guessing one would
-- close requests that are still real.
create index if not exists blood_requests_expiry_idx
  on public.blood_requests (needed_by)
  where status in ('open', 'matched') and needed_by is not null;

-- ==========================================================================
-- 20260811000020_honest_pipeline.sql
-- ==========================================================================

-- 0020  Reporting what is, not what was intended
--
-- Three symptoms, one cause, and the cause is a habit rather than a typo.
--
--   The submit screen said "no one found right now".
--   The admin panel showed the same request matched, with one recipient.
--   email_queue was completely empty, with auto_email_enabled true.
--
-- All three follow from the pipeline reporting intentions instead of facts.
--
-- 1. `emails_queued` in run_request_matcher's return was never a count of
--    anything queued. It was `auto_email`, the SETTING. The matcher does not
--    write to email_queue and never has: the only thing that does, for a blood
--    request, is the send-request-emails Edge Function. So a caller reading
--    emails_queued: true learned that emailing was switched on, and reasonably
--    concluded that emails had been queued.
--
-- 2. `matched_count` was `get diagnostics row_count` — rows inserted BY THIS
--    CALL. The matcher deliberately skips donors already recorded against the
--    request, which makes it safe to re-run, but it also means the second call
--    reports 0 for a request with recipients. Verified: first call 1, second
--    call 0, one recipient actually on the request throughout.
--
-- 3. submit.ts calls the Edge Function and, if that fails, falls back to
--    calling this matcher straight from the browser. When the function had
--    already run the matcher before failing, the fallback's re-run returned 0,
--    and the browser rendered a real match as "nobody found". The fallback also
--    cannot queue email, because nothing in the database can, which is exactly
--    the state observed: recipients present, email_queue empty.
--
-- So the return value changes to describe the request's actual state:
--
--   matched_count   how many people are being told, in total, right now
--   newly_matched   how many this call added, which is what was there before
--   emails_queued   rows really in email_queue for this request
--   auto_email_enabled  the setting, named as a setting
--
-- A caller can no longer mistake a switch for an outcome.

drop function if exists public.run_request_matcher(uuid);

create function public.run_request_matcher(in_request_id uuid)
returns table (
  matched_count integer,
  newly_matched integer,
  radius_km double precision,
  widened boolean,
  auto_email_enabled boolean,
  emails_queued integer
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
  -- Named donor_count, not found. FOUND is PL/pgSQL's own boolean and
  -- declaring it here is what broke this function for its entire life. See 0018.
  donor_count integer := 0;
  used_district boolean := false;
  inserted integer := 0;
  total_recipients integer := 0;
  queued_emails integer := 0;
begin
  select * into req from public.blood_requests where id = in_request_id;
  if req.id is null then
    raise exception 'request_not_found';
  end if;

  if req.status not in ('open', 'matched') then
    -- Still report the truth about the request rather than a row of zeroes.
    select count(*) into total_recipients
    from public.request_recipients where request_id = in_request_id;
    select count(*) into queued_emails
    from public.email_queue where request_id = in_request_id;
    return query select total_recipients, 0, 0::double precision, false, auto_email, queued_emails;
    return;
  end if;

  select coalesce(req.lat, d.lat), coalesce(req.lng, d.lng)
  into origin_lat, origin_lng
  from public.districts d
  where d.id = req.district_id;

  if origin_lat is null then
    raise exception 'request_has_no_usable_location';
  end if;

  -- ---------------------------------------------------------------------
  -- Widen until there are enough people, then stop.
  -- ---------------------------------------------------------------------
  for step_value in select (jsonb_array_elements_text(steps))::double precision loop
    select count(*) into donor_count
    from public.donors d
    where not d.blocked
      and d.deleted_at is null
      and d.consent_email
      and d.email is not null
      and d.blood_group = req.blood_group
      and d.lat is not null and d.lng is not null
      and (d.last_donation_date is null
           or d.last_donation_date + (cooldown || ' days')::interval <= now())
      and public.haversine_km(origin_lat, origin_lng, d.lat, d.lng) <= step_value;

    chosen_radius := step_value;
    exit when donor_count >= min_per_step;
  end loop;

  if donor_count < min_per_step and req.district_id is not null then
    select count(*) into donor_count
    from public.donors d
    where not d.blocked
      and d.deleted_at is null
      and d.consent_email
      and d.email is not null
      and d.blood_group = req.blood_group
      and d.district_id = req.district_id
      and (d.last_donation_date is null
           or d.last_donation_date + (cooldown || ' days')::interval <= now());

    if donor_count > 0 then
      used_district := true;
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Record who gets told.
  -- ---------------------------------------------------------------------
  with candidates as (
    select
      d.id as donor_id,
      round(public.haversine_km(origin_lat, origin_lng, d.lat, d.lng)::numeric, 2) as km
    from public.donors d
    where not d.blocked
      and d.deleted_at is null
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

  -- The numbers that go back to the caller are counted from the tables, not
  -- carried in a variable. A re-run now reports the request's real size rather
  -- than zero.
  select count(*) into total_recipients
  from public.request_recipients where request_id = in_request_id;

  select count(*) into queued_emails
  from public.email_queue where request_id = in_request_id;

  update public.blood_requests
  set match_radius_km = case when used_district then null else chosen_radius::integer end,
      status = case when total_recipients > 0 then 'matched' else status end
  where id = in_request_id;

  return query select total_recipients, inserted, chosen_radius, used_district, auto_email, queued_emails;
end;
$$;

revoke all on function public.run_request_matcher(uuid) from public;
grant execute on function public.run_request_matcher(uuid) to anon, authenticated;

comment on function public.run_request_matcher(uuid) is
  'Expanding radius match. matched_count is the request total, not this call''s insert count. emails_queued counts real email_queue rows, which this function never writes. Safe to re-run.';

-- ---------------------------------------------------------------------------
-- The end to end check
--
-- Every failure today has been the same shape: one component reported success
-- while a later one did nothing, and nobody was looking at the join between
-- them. This looks at the join.
--
-- It reads the actual tables after the fact. It does not call the matcher, it
-- does not trust a return value, and it does not care what any function said
-- at the time. Each row is a stage with a verdict and the number behind it.
-- ---------------------------------------------------------------------------
create or replace function public.request_pipeline_health(in_request_id uuid default null)
returns table (
  stage text,
  ok boolean,
  detail text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  req record;
  recipients integer;
  queued_recipients integer;
  skipped_recipients integer;
  queue_rows integer;
  sent_rows integer;
  failed_rows integer;
  auto_email boolean := public.setting_bool('auto_email_enabled', false);
  reachable integer;
  unreachable integer;
begin
  select r.*, d.lat as district_lat, d.lng as district_lng
  into req
  from public.blood_requests r
  left join public.districts d on d.id = r.district_id
  where (in_request_id is null or r.id = in_request_id)
  order by r.created_at desc
  limit 1;

  if req.id is null then
    return query select 'request'::text, false, 'No request found. Send one first.'::text;
    return;
  end if;

  return query select 'request'::text, true,
    format('%s, %s, created %s', req.blood_group, coalesce(req.hospital_name_free_text, '(no hospital name)'),
           to_char(req.created_at, 'YYYY-MM-DD HH24:MI'));

  -- 1. Can the matcher even start?
  return query select 'origin'::text,
    coalesce(req.lat, req.district_lat) is not null,
    case
      when req.lat is not null then format('map pin at %s, %s', round(req.lat::numeric,4), round(req.lng::numeric,4))
      when req.district_lat is not null then 'district centre (no map pin on this request)'
      else 'NO USABLE LOCATION: the matcher raises on this request'
    end;

  -- 2. Did matching actually record anybody?
  select count(*) into recipients from public.request_recipients where request_id = req.id;
  select count(*) into queued_recipients from public.request_recipients where request_id = req.id and email_status = 'queued';
  select count(*) into skipped_recipients from public.request_recipients where request_id = req.id and email_status = 'skipped';

  return query select 'matched'::text, recipients > 0,
    format('%s recipient(s) recorded: %s queued, %s skipped', recipients, queued_recipients, skipped_recipients);

  -- Nobody matched is not always a bug, so say which kind it is.
  if recipients = 0 then
    select count(*) into reachable
    from public.donors d
    where d.blood_group = req.blood_group and not d.blocked and d.deleted_at is null
      and d.consent_email and d.email is not null;
    select count(*) into unreachable
    from public.donors d
    where d.blood_group = req.blood_group and not d.blocked and d.deleted_at is null
      and (d.email is null or not d.consent_email);

    return query select 'why not'::text, false,
      format('%s contactable donor(s) of this group exist anywhere, and %s more have no email address so cannot be told at all',
             reachable, unreachable);
  end if;

  -- 3. The setting, stated plainly.
  return query select 'auto_email_enabled'::text, auto_email,
    case when auto_email then 'on: recipients are recorded as queued'
         else 'OFF: recipients are recorded as skipped and nothing will ever be queued' end;

  -- 4. THE CHECK THAT WOULD HAVE CAUGHT TODAY.
  --
  -- Recipients marked 'queued' with nothing in email_queue means the matcher
  -- ran but send-request-emails did not, or failed after it. Nothing in the
  -- database writes to email_queue; only that Edge Function does. This is
  -- exactly the state that looked like "the queue is empty so sending is
  -- broken" when in fact nothing was ever enqueued.
  select count(*) into queue_rows from public.email_queue where request_id = req.id;

  return query select 'enqueued'::text,
    (queued_recipients = 0 or queue_rows > 0),
    case
      when queued_recipients > 0 and queue_rows = 0 then
        format('BROKEN: %s recipient(s) marked queued but 0 rows in email_queue. '
               || 'The matcher ran and send-request-emails did not, or failed after it. '
               || 'Nothing in the database writes to email_queue.', queued_recipients)
      when queued_recipients = 0 then 'nothing was due to be queued'
      else format('%s row(s) in email_queue', queue_rows)
    end;

  -- 5. Did the drainer do its job?
  select count(*) into sent_rows from public.email_queue where request_id = req.id and status = 'sent';
  select count(*) into failed_rows from public.email_queue where request_id = req.id and status = 'failed';

  if queue_rows > 0 then
    return query select 'delivered'::text, sent_rows > 0,
      format('%s sent, %s failed, %s still waiting for the drainer',
             sent_rows, failed_rows, queue_rows - sent_rows - failed_rows);
  end if;

  -- 6. Consistency between the two tables that must agree.
  return query select 'consistent'::text,
    (queue_rows <= recipients),
    format('%s recipient(s), %s queue row(s)', recipients, queue_rows);
end;
$$;

revoke all on function public.request_pipeline_health(uuid) from public, anon;
grant execute on function public.request_pipeline_health(uuid) to authenticated;

comment on function public.request_pipeline_health(uuid) is
  'End to end state of one request, read from the tables. Pass null for the most recent. Never calls the matcher and never trusts a return value.';

-- ---------------------------------------------------------------------------
-- Hospital names that survive being chosen from a list
--
-- Picking "Evercare" from the dropdown set hospital_id and left
-- hospital_name_free_text null, and the admin table reads only the free text
-- column, so it rendered a dash. The name existed; nothing joined to it.
--
-- Rather than teach every reader to join, the name is stored as text whichever
-- way it was entered. hospital_id stays for the coordinates, but it is no
-- longer the only place the name lives.
-- ---------------------------------------------------------------------------
update public.blood_requests r
set hospital_name_free_text = h.name_en
from public.hospitals h
where r.hospital_id = h.id
  and r.hospital_name_free_text is null;

-- ---------------------------------------------------------------------------
-- An area on the request, the same as the donor has
--
-- The donor form asks where you are and fills it in from the geocoder. The
-- request form never did, so "where is the blood needed" was a district and a
-- hospital name and nothing in between. In Dhaka that is the difference
-- between Gulshan and Mirpur, which is an hour in traffic.
-- ---------------------------------------------------------------------------
alter table public.blood_requests
  add column if not exists area_name text;

alter table public.blood_requests drop constraint if exists blood_requests_area_name_length;
alter table public.blood_requests add constraint blood_requests_area_name_length
  check (area_name is null or char_length(btrim(area_name)) between 1 and 60);

comment on column public.blood_requests.area_name is
  'Neighbourhood where the blood is needed, e.g. "Gulshan 1". Auto-filled from the geocoder, editable.';

-- ---------------------------------------------------------------------------
-- Hospitals the seed has never heard of
--
-- 42 seeded hospitals cannot cover Bangladesh, and most emergencies happen
-- somewhere that is not on the list. hospital_name_free_text has always
-- allowed any name; only the UI insisted on the dropdown.
--
-- Nothing in the schema needs to change for that, which is the point of this
-- note: matching reads blood_requests.lat/lng, falling back to the district
-- centre, and never reads the hospital row. An unlisted hospital matches
-- exactly as well as a listed one, as long as there is a map pin. The check
-- below is the guarantee: a request must carry either coordinates or a
-- district, whoever typed the hospital name.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'blood_requests_has_location'
  ) then
    alter table public.blood_requests add constraint blood_requests_has_location
      check (district_id is not null or (lat is not null and lng is not null));
  end if;
end
$$;

-- ==========================================================================
-- 20260811000021_queue_dedupe_key.sql
-- ==========================================================================

-- 0021  An ON CONFLICT target that Postgres can actually use
--
--   send-request-emails failed { code: "42P10",
--     message: "there is no unique or exclusion constraint matching the
--               ON CONFLICT specification" }
--
-- 0012 gave email_queue two unique indexes, and made both of them PARTIAL:
--
--   email_queue_recipient_kind_idx  on (recipient_id, kind)
--     where recipient_id is not null
--   email_queue_request_kind_idx    on (request_id, kind)
--     where recipient_id is null and request_id is not null
--
-- A partial unique index can only arbitrate an ON CONFLICT when the statement
-- repeats the index's WHERE clause. PostgREST's `on_conflict=` parameter emits
-- a bare `ON CONFLICT (cols)` with no predicate, so Postgres cannot match
-- either index and raises 42P10 before writing anything.
--
-- Both upserts in send-request-emails hit this, so the function died on the
-- first one. That is why email_queue was empty while request_recipients said
-- 'queued': the matcher runs earlier in the same function and had already
-- committed its rows.
--
-- Reproduced against a real Postgres before writing this, with the exact
-- statements PostgREST generates. Both raise 42P10.
--
-- The fix is one non-partial unique index over a generated column that encodes
-- the same rule the two partial indexes encoded between them:
--
--   one email of each kind per recipient row      -> r:<recipient_id>|<kind>
--   one of each kind per request without one      -> q:<request_id>|<kind>
--   anything else                                 -> null, never deduplicated
--
-- Null is right for the third case. certificate_link mail belongs to neither a
-- recipient nor a request, and nulls are distinct in a unique index, so those
-- rows simply never collide. Their own rate limit lives in
-- certificate_link_recently_sent.

alter table public.email_queue
  add column if not exists dedupe_key text
  generated always as (
    case
      when recipient_id is not null then 'r:' || recipient_id::text || '|' || kind
      when request_id is not null then 'q:' || request_id::text || '|' || kind
      else null
    end
  ) stored;

comment on column public.email_queue.dedupe_key is
  'Generated. The ON CONFLICT arbiter for every queue upsert. Null means "this row is not deduplicated", which is correct for mail belonging to neither a recipient nor a request.';

-- Non-partial, so `on conflict (dedupe_key)` is a legal arbiter.
create unique index if not exists email_queue_dedupe_idx
  on public.email_queue (dedupe_key);

-- The old indexes stay. They still enforce exactly the same rule, they are
-- what the drainer's lookups use, and dropping working constraints to tidy up
-- after a bug is how the next bug gets in.

-- ---------------------------------------------------------------------------
-- Prove the arbiter works, at migration time
--
-- This is exactly the sort of claim that gets asserted in a comment and turns
-- out to be false. It is checked instead, using EXPLAIN: planning an INSERT
-- raises 42P10 when no usable arbiter exists, and writes nothing when one
-- does. So this fails the migration rather than production if the index is
-- ever made partial again.
-- ---------------------------------------------------------------------------
do $$
begin
  execute $probe$
    explain (costs off)
    insert into public.email_queue (to_email, subject, html_body, text_body, kind)
    values ('probe@example.invalid', 'probe', '<p>probe</p>', 'probe', 'donor_request')
    on conflict (dedupe_key) do nothing
  $probe$;
exception
  when others then
    raise exception
      'email_queue has no usable ON CONFLICT arbiter for dedupe_key (%). '
      'Every queue upsert would fail with 42P10, exactly as it did before this migration.',
      sqlerrm;
end
$$;

-- The dedupe rule itself is verified in scripts/diagnostics/, not here: a
-- check written in the same file as the thing it checks tends to agree with
-- it by construction, which is how the last three bugs passed review.

-- ---------------------------------------------------------------------------
-- The health check was crying wolf
--
-- 0020's `consistent` stage compared every email_queue row for a request
-- against the number of recipients, and failed whenever both were correct: a
-- request with one donor and a requester confirmation has one recipient and
-- TWO queue rows. The confirmation is addressed to the requester and has no
-- recipient row by design.
--
-- A check that reports a problem when there is none is worse than no check.
-- It is the same failure as everything else this week — reporting something
-- other than what is true — and it would have taught its reader to skip that
-- line, which is where the real one eventually hides.
--
-- Counting is now per kind, which is also more useful: donor mail and the
-- requester's confirmation fail for different reasons.
-- ---------------------------------------------------------------------------
create or replace function public.request_pipeline_health(in_request_id uuid default null)
returns table (
  stage text,
  ok boolean,
  detail text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  req record;
  recipients integer;
  queued_recipients integer;
  skipped_recipients integer;
  donor_rows integer;
  confirm_rows integer;
  sent_rows integer;
  failed_rows integer;
  waiting_rows integer;
  auto_email boolean := public.setting_bool('auto_email_enabled', false);
  reachable integer;
  unreachable integer;
begin
  select r.*, d.lat as district_lat, d.lng as district_lng
  into req
  from public.blood_requests r
  left join public.districts d on d.id = r.district_id
  where (in_request_id is null or r.id = in_request_id)
  order by r.created_at desc
  limit 1;

  if req.id is null then
    return query select 'request'::text, false, 'No request found. Send one first.'::text;
    return;
  end if;

  return query select 'request'::text, true,
    format('%s, %s, created %s', req.blood_group,
           coalesce(req.hospital_name_free_text, '(no hospital name)'),
           to_char(req.created_at, 'YYYY-MM-DD HH24:MI'));

  -- 1. Can the matcher even start?
  return query select 'origin'::text,
    coalesce(req.lat, req.district_lat) is not null,
    case
      when req.lat is not null then format('map pin at %s, %s', round(req.lat::numeric,4), round(req.lng::numeric,4))
      when req.district_lat is not null then 'district centre (no map pin on this request)'
      else 'NO USABLE LOCATION: the matcher raises on this request'
    end;

  -- 2. Did matching actually record anybody?
  select count(*) into recipients from public.request_recipients where request_id = req.id;
  select count(*) into queued_recipients from public.request_recipients
    where request_id = req.id and email_status = 'queued';
  select count(*) into skipped_recipients from public.request_recipients
    where request_id = req.id and email_status = 'skipped';

  return query select 'matched'::text, recipients > 0,
    format('%s recipient(s) recorded: %s queued, %s skipped', recipients, queued_recipients, skipped_recipients);

  if recipients = 0 then
    select count(*) into reachable
    from public.donors d
    where d.blood_group = req.blood_group and not d.blocked and d.deleted_at is null
      and d.consent_email and d.email is not null;
    select count(*) into unreachable
    from public.donors d
    where d.blood_group = req.blood_group and not d.blocked and d.deleted_at is null
      and (d.email is null or not d.consent_email);

    return query select 'why not'::text, false,
      format('%s contactable donor(s) of this group exist anywhere, and %s more have no email address so cannot be told at all',
             reachable, unreachable);
  end if;

  return query select 'auto_email_enabled'::text, auto_email,
    case when auto_email then 'on: recipients are recorded as queued'
         else 'OFF: recipients are recorded as skipped and nothing will ever be queued' end;

  -- 3. Donor mail. This is the check that caught 42P10.
  select count(*) into donor_rows
  from public.email_queue where request_id = req.id and kind = 'donor_request';

  return query select 'donor mail queued'::text,
    (queued_recipients = 0 or donor_rows >= queued_recipients),
    case
      when queued_recipients > 0 and donor_rows = 0 then
        format('BROKEN: %s recipient(s) marked queued but 0 donor emails in email_queue. '
               || 'The matcher ran and send-request-emails did not, or failed after it. '
               || 'Nothing in the database writes to email_queue.', queued_recipients)
      when queued_recipients = 0 then 'nothing was due to be queued'
      else format('%s of %s donor email(s) queued', donor_rows, queued_recipients)
    end;

  -- 4. The requester's own confirmation, which has no recipient row and so
  --    must be counted separately rather than treated as a surplus.
  select count(*) into confirm_rows
  from public.email_queue where request_id = req.id and kind = 'requester_confirmation';

  return query select 'requester confirmation'::text,
    (req.requester_email is null or confirm_rows > 0),
    case
      when req.requester_email is null then 'no email address given, so none is due'
      when confirm_rows = 0 then 'not queued. The donors may still have been; check the function logs.'
      else 'queued'
    end;

  -- 5. Did the drainer do its job?
  select count(*) into sent_rows from public.email_queue
    where request_id = req.id and status = 'sent';
  select count(*) into failed_rows from public.email_queue
    where request_id = req.id and status = 'failed';
  select count(*) into waiting_rows from public.email_queue
    where request_id = req.id and status = 'queued';

  if donor_rows + confirm_rows > 0 then
    return query select 'delivered'::text,
      -- Waiting is not failing. The drainer runs on a schedule, and GitHub's
      -- can be an hour late, so a fresh request being unsent is expected.
      (failed_rows = 0),
      format('%s sent, %s failed, %s waiting for the drainer', sent_rows, failed_rows, waiting_rows);
  end if;
end;
$$;

revoke all on function public.request_pipeline_health(uuid) from public, anon;
grant execute on function public.request_pipeline_health(uuid) to authenticated;

commit;
