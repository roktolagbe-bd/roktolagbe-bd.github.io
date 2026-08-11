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
