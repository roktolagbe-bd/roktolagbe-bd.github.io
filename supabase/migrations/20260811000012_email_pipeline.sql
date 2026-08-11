-- 0013  What the email pipeline needs from the database
--
-- Two things: a way to never send the same email twice, and a way to hash a
-- caller's IP address without ever storing it.

-- ---------------------------------------------------------------------------
-- Idempotency
--
-- The queue is drained on a schedule and the sender can be called again after
-- a timeout, so "did I already write this one" has to be answered by the
-- database rather than by hoping. One email of each kind per recipient row.
-- ---------------------------------------------------------------------------
create unique index if not exists email_queue_recipient_kind_idx
  on public.email_queue (recipient_id, kind)
  where recipient_id is not null;

-- The requester's confirmation and each acceptance are keyed on the request.
-- Acceptances differ per donor, so they carry the recipient id too and are
-- covered by the index above.
create unique index if not exists email_queue_request_kind_idx
  on public.email_queue (request_id, kind)
  where recipient_id is null and request_id is not null;

-- ---------------------------------------------------------------------------
-- Hashing a caller's IP
--
-- Raw addresses are never stored. The Edge Function passes the address in, and
-- this salts and hashes it so that a leak of donors or blood_requests cannot
-- be used to work out who was searching for blood.
--
-- The salt lives in a database setting, not in the repo. Set it once with:
--
--   alter database postgres set app.ip_salt = 'some long random string';
--
-- If it is unset the function still works, but the hashes are only as good as
-- the fixed fallback, so set it.
-- ---------------------------------------------------------------------------
create or replace function public.hash_ip(in_ip text)
returns text
language plpgsql
stable
as $$
declare
  salt text;
begin
  if in_ip is null or btrim(in_ip) = '' then
    return null;
  end if;

  begin
    salt := current_setting('app.ip_salt');
  exception
    when others then
      salt := 'roktolagbe-unsalted-please-set-app.ip_salt';
  end;

  return encode(digest(salt || '|' || btrim(in_ip), 'sha256'), 'hex');
end;
$$;

revoke all on function public.hash_ip(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rate limiting from the Edge Function
--
-- The triggers in 0008 only fire on INSERT, and a browser cannot see its own
-- public address, so until now ip_hash was always null and the cap never
-- applied. The Edge Function calls this BEFORE it does any work, with the
-- address it can see, and stamps the row afterwards.
--
-- Returns true when the caller is within the cap.
-- ---------------------------------------------------------------------------
create or replace function public.check_and_record_ip(
  in_ip text,
  in_kind text,
  in_target_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hashed text := public.hash_ip(in_ip);
  recent integer;
  cap integer;
begin
  if hashed is null then
    return true; -- nothing to key on; the honeypot and timing checks stand
  end if;

  if in_kind = 'request' then
    cap := public.setting_int('max_requests_per_ip_per_hour', 3);
    select count(*) into recent
    from public.blood_requests
    where ip_hash = hashed
      and created_at > now() - interval '1 hour'
      and id <> in_target_id;

    if recent >= cap then
      return false;
    end if;

    update public.blood_requests set ip_hash = hashed where id = in_target_id;
  else
    cap := public.setting_int('max_registrations_per_ip_per_hour', 3);
    select count(*) into recent
    from public.donors
    where ip_hash = hashed
      and created_at > now() - interval '1 hour'
      and id <> in_target_id;

    if recent >= cap then
      return false;
    end if;

    update public.donors set ip_hash = hashed where id = in_target_id;
  end if;

  return true;
end;
$$;

revoke all on function public.check_and_record_ip(text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Everything the donor email needs, in one row
--
-- The Edge Function runs as service_role and could read the tables directly,
-- but a single function keeps the shape of a donor email in one reviewable
-- place, next to the rules about what may go in it.
-- ---------------------------------------------------------------------------
create or replace function public.pending_donor_emails(in_request_id uuid, in_limit integer)
returns table (
  recipient_id uuid,
  donor_email citext,
  donor_name text,
  opt_out_token uuid,
  response_token uuid,
  distance_km numeric,
  blood_group public.blood_group,
  units_needed integer,
  urgency public.urgency_level,
  hospital_name text,
  district_name text,
  needed_by timestamptz,
  patient_note text,
  requester_name text,
  request_lat double precision,
  request_lng double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rr.id,
    d.email,
    d.display_name,
    d.opt_out_token,
    rr.response_token,
    rr.distance_km,
    r.blood_group,
    r.units_needed,
    r.urgency,
    coalesce(h.name_en, r.hospital_name_free_text),
    dis.name_en,
    r.needed_by,
    r.patient_note,
    r.requester_name,
    coalesce(r.lat, h.lat, dis.lat),
    coalesce(r.lng, h.lng, dis.lng)
  from public.request_recipients rr
  join public.blood_requests r on r.id = rr.request_id
  join public.donors d on d.id = rr.donor_id
  left join public.hospitals h on h.id = r.hospital_id
  left join public.districts dis on dis.id = r.district_id
  where rr.request_id = in_request_id
    and rr.email_status = 'queued'
    and d.email is not null
    and d.consent_email
    and not d.blocked
    -- Nothing already written to the queue for this recipient.
    and not exists (
      select 1 from public.email_queue q
      where q.recipient_id = rr.id and q.kind = 'donor_request'
    )
  limit in_limit;
$$;

revoke all on function public.pending_donor_emails(uuid, integer) from public, anon, authenticated;

-- Contact details for one acceptance, for the email that goes back to the
-- requester. This is the single point at which a donor's number leaves.
create or replace function public.acceptance_details(in_recipient_id uuid)
returns table (
  request_id uuid,
  requester_email citext,
  requester_name text,
  donor_name text,
  donor_phone text,
  donor_whatsapp text,
  donor_district text,
  distance_km numeric,
  blood_group public.blood_group
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.requester_email,
    r.requester_name,
    d.display_name,
    d.phone,
    d.whatsapp,
    dis.name_en,
    rr.distance_km,
    d.blood_group
  from public.request_recipients rr
  join public.blood_requests r on r.id = rr.request_id
  join public.donors d on d.id = rr.donor_id
  left join public.districts dis on dis.id = d.district_id
  where rr.id = in_recipient_id
    and rr.response = 'accepted';
$$;

revoke all on function public.acceptance_details(uuid) from public, anon, authenticated;
