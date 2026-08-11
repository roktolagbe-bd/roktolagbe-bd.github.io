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
