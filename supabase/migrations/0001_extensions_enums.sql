-- 0001  Extensions and enumerated types
--
-- Paste these migration files into the Supabase SQL editor in numeric order.
-- Every file is safe to run twice.
--
-- Read supabase/migrations/0009_rls_policies.sql before changing anything in
-- here. The privacy rules of this project are enforced in Postgres, and the
-- shape of these tables is what makes that possible.

create extension if not exists "pgcrypto"; -- gen_random_uuid(), digest()
create extension if not exists "citext"; -- case-insensitive email

-- Enum types are created guarded so a re-run does not error.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'blood_group') then
    create type public.blood_group as enum ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');
  end if;

  if not exists (select 1 from pg_type where typname = 'urgency_level') then
    create type public.urgency_level as enum ('critical', 'urgent', 'scheduled');
  end if;

  if not exists (select 1 from pg_type where typname = 'request_status') then
    create type public.request_status as enum ('open', 'matched', 'fulfilled', 'expired', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'email_status') then
    create type public.email_status as enum ('queued', 'sent', 'failed', 'skipped');
  end if;

  if not exists (select 1 from pg_type where typname = 'response_status') then
    create type public.response_status as enum ('pending', 'accepted', 'declined');
  end if;
end
$$;

-- Keeps updated_at honest without the application having to remember.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
