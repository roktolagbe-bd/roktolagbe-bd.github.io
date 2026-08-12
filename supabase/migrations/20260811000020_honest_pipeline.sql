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
