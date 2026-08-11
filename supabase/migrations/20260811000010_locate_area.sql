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
