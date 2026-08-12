-- Why did my last blood request match nobody?
--
-- Paste into the Supabase SQL editor and run. Read-only: it changes nothing.
--
-- The requester's screen says "no one found" for several different reasons and
-- cannot tell them apart. This does. For the most recent request it lists every
-- donor of the right blood group and says, per donor, exactly which condition
-- the matcher tripped on.

with req as (
  select r.*,
         coalesce(r.lat, d.lat) as origin_lat,
         coalesce(r.lng, d.lng) as origin_lng,
         (r.lat is null) as using_district_centre,
         d.name_en as district
  from public.blood_requests r
  left join public.districts d on d.id = r.district_id
  order by r.created_at desc
  limit 1
)
select
  'REQUEST' as row_kind,
  req.created_at::text          as created,
  req.blood_group::text         as blood_group,
  req.district                  as district,
  case when req.using_district_centre
       then 'district centre (request has no coordinates)'
       else 'exact point from the requester' end as origin,
  round(req.origin_lat::numeric, 4)::text || ', ' || round(req.origin_lng::numeric, 4)::text as origin_point,
  null as verdict
from req

union all

select
  'DONOR',
  d.created_at::text,
  d.blood_group::text,
  coalesce(d.area_name, '(no area)'),
  coalesce(round(public.haversine_km(req.origin_lat, req.origin_lng, d.lat, d.lng)::numeric, 1)::text || ' km',
           'no coordinates'),
  coalesce(d.email::text, '(no email)'),
  -- First failing condition wins, in the order the matcher applies them.
  case
    when d.blocked                      then 'EXCLUDED: blocked'
    when d.deleted_at is not null        then 'EXCLUDED: deleted'
    when d.blood_group <> req.blood_group then 'EXCLUDED: different blood group'
    when not d.consent_email             then 'EXCLUDED: consent_email is false'
    when d.email is null                 then 'EXCLUDED: no email address on file'
    when d.last_donation_date is not null
     and d.last_donation_date + (public.setting_int('donor_cooldown_days',120) || ' days')::interval > now()
                                         then 'EXCLUDED: still inside the donation cooldown'
    when d.lat is null or d.lng is null  then 'ONLY VIA DISTRICT: donor has no coordinates'
    when public.haversine_km(req.origin_lat, req.origin_lng, d.lat, d.lng) > 50
                                         then 'EXCLUDED: further than the widest radius (50km)'
    else 'MATCHES'
  end
from public.donors d, req
order by row_kind desc, created;


-- ---------------------------------------------------------------------------
-- Re-running a request that was matched before 0018 was applied
--
-- Every request created while the matcher was broken has no recipients. The
-- matcher is safe to re-run: it skips donors it has already recorded for that
-- request, so running it twice cannot contact anybody twice.
--
-- Uncomment and run to retry the most recent request:
-- ---------------------------------------------------------------------------

-- select * from public.run_request_matcher(
--   (select id from public.blood_requests order by created_at desc limit 1)
-- );

-- Or every open request that never found anybody:

-- select r.id, m.*
-- from public.blood_requests r
-- cross join lateral public.run_request_matcher(r.id) m
-- where r.status = 'open'
--   and not exists (select 1 from public.request_recipients rr where rr.request_id = r.id);

-- How many donors were near enough but had no email address on file, and so
-- could not be contacted at all:

-- select public.unreachable_donors_near(
--   (select id from public.blood_requests order by created_at desc limit 1)
-- ) as near_but_unreachable;
