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
