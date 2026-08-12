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
