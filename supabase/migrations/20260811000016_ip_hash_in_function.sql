-- 0016  Hash the caller's IP before it reaches the database
--
-- The salt used to live in a database setting:
--
--   alter database postgres set app.ip_salt = '...'
--
-- That cannot work on hosted Supabase. The `postgres` role there is not the
-- database owner, so ALTER DATABASE ... SET fails with
--
--   ERROR: 42501: permission denied to set parameter
--
-- at every plan level. It is not a quota, it is the shape of the platform, and
-- no amount of paying changes it.
--
-- Worse, the old hash_ip() swallowed the failure. current_setting() raises
-- when the setting is absent, the exception handler caught it, and the
-- function carried on with a fallback salt written in plain text in this
-- repository. So the hashes looked salted and were not: anyone holding a dump
-- of donors or blood_requests could reproduce them from a public constant and
-- walk the whole IPv4 space in about an hour on one core.
--
-- So the salt moves to where secrets on this platform actually live, an Edge
-- Function secret named IP_SALT, and the hashing moves with it.
--
-- That turns out to be the better design anyway. The raw address now never
-- reaches Postgres at all: the function hashes it and passes the digest. There
-- is no longer any code path, trigger, log line or `select` that could put a
-- caller's IP address in the database, which is a stronger promise than "we
-- hash it on arrival".

-- ---------------------------------------------------------------------------
-- hash_ip is gone
--
-- Dropped rather than left in place. A function that takes a raw IP address is
-- an invitation to pass one, and there is nothing left that should.
-- ---------------------------------------------------------------------------
drop function if exists public.hash_ip(text);

-- ---------------------------------------------------------------------------
-- The rate limit now takes a digest, not an address
-- ---------------------------------------------------------------------------
drop function if exists public.check_and_record_ip(text, text, uuid);

create function public.check_and_record_ip(
  in_ip_hash text,
  in_kind text,
  in_target_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hashed text := nullif(btrim(coalesce(in_ip_hash, '')), '');
  recent integer;
  cap integer;
begin
  -- No digest means the function could not produce one, which today means
  -- IP_SALT is unset. Nothing to key on, so the honeypot and the time-on-page
  -- check stand alone. Deliberately not an error: a missing salt should not
  -- stop somebody asking for blood.
  if hashed is null then
    return true;
  end if;

  -- Refuse anything that is not a SHA-256 digest. This is the boundary where
  -- a raw address would show up if some future caller passed one by mistake,
  -- and it is much better to drop it here than to store it in ip_hash.
  if hashed !~ '^[0-9a-f]{64}$' then
    raise warning 'check_and_record_ip: expected a sha256 hex digest, refusing to store the value given';
    return true;
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

comment on function public.check_and_record_ip(text, text, uuid) is
  'Takes a SHA-256 hex digest of the caller IP, never the address. Salting and hashing happen in the Edge Function, using the IP_SALT secret.';

-- ---------------------------------------------------------------------------
-- Old hashes are not worth keeping
--
-- Every ip_hash written before this migration was computed with the fallback
-- salt printed in the repository, so each one is a reversible record of a real
-- person's address. They cannot be re-hashed, because the input is gone, and
-- they are useless for rate limiting once the salt changes. Clearing them is
-- the only option that leaves nothing behind.
-- ---------------------------------------------------------------------------
update public.donors set ip_hash = null where ip_hash is not null;
update public.blood_requests set ip_hash = null where ip_hash is not null;
