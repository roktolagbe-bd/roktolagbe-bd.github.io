-- 0008  Matching, rate limiting, and the tokenised donor response
--
-- Every function here that touches private data is SECURITY DEFINER and
-- returns only what the caller is entitled to. None of them ever return a
-- donor's phone number to an anonymous caller except the one narrow case the
-- whole product exists for: a donor accepted a request, so that requester
-- gets that donor's number.

-- ---------------------------------------------------------------------------
-- Distance
-- ---------------------------------------------------------------------------
create or replace function public.haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ---------------------------------------------------------------------------
-- nearby_donors
--
-- The public search. Returns the same shape as donors_public plus a distance,
-- and only donors who consented to public listing.
--
-- Distance is measured from the TRUE donor position so the ranking is honest,
-- but the position returned is the fuzzed one. The caller learns "about 3km
-- away", never where.
-- ---------------------------------------------------------------------------
create or replace function public.nearby_donors(
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

-- ---------------------------------------------------------------------------
-- match_donors_for_request
--
-- Used by the send-request-emails Edge Function, which runs as service_role.
-- Returns donor ids and emails, so it must never be callable by anon.
--
-- Consent rules differ from public search on purpose: a donor who declined
-- public listing can still be emailed if they consented to email. They chose
-- not to be browsable, not to be unreachable in an emergency.
-- ---------------------------------------------------------------------------
create or replace function public.match_donors_for_request(
  in_request_id uuid,
  in_radius_km double precision,
  in_max_results integer
)
returns table (donor_id uuid, email citext, distance_km double precision)
language sql
stable
security definer
set search_path = public
as $$
  with req as (
    select r.*, coalesce(r.lat, dis.lat) as origin_lat, coalesce(r.lng, dis.lng) as origin_lng
    from public.blood_requests r
    left join public.districts dis on dis.id = r.district_id
    where r.id = in_request_id
  ),
  cooldown as (select public.setting_int('donor_cooldown_days', 120) as days)
  select
    d.id,
    d.email,
    round(public.haversine_km(req.origin_lat, req.origin_lng, d.lat, d.lng)::numeric, 1)::double precision
  from public.donors d
  cross join req
  cross join cooldown c
  where not d.blocked
    and d.consent_email
    and d.email is not null
    and d.blood_group = req.blood_group
    and d.lat is not null and d.lng is not null
    and (d.last_donation_date is null
         or d.last_donation_date + (c.days || ' days')::interval <= now())
    and public.haversine_km(req.origin_lat, req.origin_lng, d.lat, d.lng) <= in_radius_km
    -- Never contact the same donor twice about the same request.
    and not exists (
      select 1 from public.request_recipients rr
      where rr.request_id = in_request_id and rr.donor_id = d.id
    )
  order by public.haversine_km(req.origin_lat, req.origin_lng, d.lat, d.lng) asc
  limit greatest(coalesce(in_max_results, 25), 0);
$$;

revoke all on function public.match_donors_for_request(uuid, double precision, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Abuse control
--
-- Raw IP addresses are never stored. The Edge Function hashes the address with
-- a server-side salt before it reaches the database, so a leak of this table
-- does not reveal who was searching for blood.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_request_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
  cap integer := public.setting_int('max_requests_per_ip_per_hour', 3);
begin
  if new.ip_hash is null then
    return new; -- nothing to key on; the honeypot and timing checks still apply
  end if;

  select count(*) into recent
  from public.blood_requests
  where ip_hash = new.ip_hash
    and created_at > now() - interval '1 hour';

  if recent >= cap then
    raise exception 'rate_limit_exceeded'
      using hint = 'Too many requests from this connection in the last hour.',
            errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists blood_requests_rate_limit on public.blood_requests;
create trigger blood_requests_rate_limit
  before insert on public.blood_requests
  for each row execute function public.enforce_request_rate_limit();

create or replace function public.enforce_donor_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
  cap integer := public.setting_int('max_registrations_per_ip_per_hour', 3);
begin
  if new.ip_hash is null then
    return new;
  end if;

  select count(*) into recent
  from public.donors
  where ip_hash = new.ip_hash
    and created_at > now() - interval '1 hour';

  if recent >= cap then
    raise exception 'rate_limit_exceeded'
      using hint = 'Too many registrations from this connection in the last hour.',
            errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists donors_rate_limit on public.donors;
create trigger donors_rate_limit
  before insert on public.donors
  for each row execute function public.enforce_donor_rate_limit();

-- ---------------------------------------------------------------------------
-- The donor response page
--
-- Reached from a link in an email. No login, no session, just a token that is
-- good for one request and one donor.
--
-- get_request_by_token returns the requester's contact details, because a
-- donor deciding whether to help is entitled to know who is asking. It returns
-- nothing at all once the request is closed, so an old email cannot be used to
-- mine contact details later.
-- ---------------------------------------------------------------------------
create or replace function public.get_request_by_token(in_token uuid)
returns table (
  request_id uuid,
  blood_group public.blood_group,
  units_needed integer,
  urgency public.urgency_level,
  hospital_name text,
  district_en text,
  district_bn text,
  needed_by timestamptz,
  patient_note text,
  requester_name text,
  status public.request_status,
  distance_km numeric,
  already_responded public.response_status
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.blood_group,
    r.units_needed,
    r.urgency,
    coalesce(h.name_en, r.hospital_name_free_text),
    d.name_en,
    d.name_bn,
    r.needed_by,
    r.patient_note,
    r.requester_name,
    r.status,
    rr.distance_km,
    rr.response
  from public.request_recipients rr
  join public.blood_requests r on r.id = rr.request_id
  left join public.hospitals h on h.id = r.hospital_id
  left join public.districts d on d.id = r.district_id
  where rr.response_token = in_token
    and r.status in ('open', 'matched');
$$;

revoke all on function public.get_request_by_token(uuid) from public;
grant execute on function public.get_request_by_token(uuid) to anon, authenticated;

-- Accept or decline. On accept, the requester's contact details are returned
-- to the donor, and the mailer separately sends the donor's details to the
-- requester. This is the only path by which contact information moves.
create or replace function public.respond_to_request(in_token uuid, in_accept boolean)
returns table (
  ok boolean,
  requester_name text,
  requester_phone text,
  requester_whatsapp text,
  hospital_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  select rr.*, r.status as request_status
  into rec
  from public.request_recipients rr
  join public.blood_requests r on r.id = rr.request_id
  where rr.response_token = in_token
  for update;

  if not found or rec.request_status not in ('open', 'matched') then
    return query select false, null::text, null::text, null::text, null::text;
    return;
  end if;

  update public.request_recipients
  set response = case when in_accept then 'accepted' else 'declined' end::public.response_status
  where id = rec.id;

  if in_accept then
    update public.blood_requests
    set status = 'matched'
    where id = rec.request_id and status = 'open';

    return query
    select true, r.requester_name, r.requester_phone, r.requester_whatsapp,
           coalesce(h.name_en, r.hospital_name_free_text)
    from public.blood_requests r
    left join public.hospitals h on h.id = r.hospital_id
    where r.id = rec.request_id;
  else
    return query select true, null::text, null::text, null::text, null::text;
  end if;
end;
$$;

revoke all on function public.respond_to_request(uuid, boolean) from public;
grant execute on function public.respond_to_request(uuid, boolean) to anon, authenticated;

-- Opt out. One click from any email, no login, no confirmation screen that
-- talks someone out of it.
create or replace function public.opt_out_donor(in_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.donors
  set consent_email = false, consent_public_listing = false
  where opt_out_token = in_token;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.opt_out_donor(uuid) from public;
grant execute on function public.opt_out_donor(uuid) to anon, authenticated;

-- Remaining Gmail allowance for today, shown in the admin panel.
create or replace function public.email_quota_remaining()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    0,
    public.setting_int('daily_email_cap', 400)
      - (select count(*)::integer from public.email_queue
         where status = 'sent' and sent_at > date_trunc('day', now()))
  );
$$;
