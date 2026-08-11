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
