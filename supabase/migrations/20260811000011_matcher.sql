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
