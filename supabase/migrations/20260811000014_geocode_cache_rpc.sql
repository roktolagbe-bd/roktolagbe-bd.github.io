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
