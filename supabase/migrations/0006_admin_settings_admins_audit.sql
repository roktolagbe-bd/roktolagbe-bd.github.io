-- 0006  Settings, the admin allowlist, and the audit log

-- ---------------------------------------------------------------------------
-- admin_settings
--
-- A key/value store so an admin can change how the system behaves without a
-- deploy. auto_email_enabled is the important one: it is the master switch,
-- and every send path reads it before doing anything.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

drop trigger if exists admin_settings_set_updated_at on public.admin_settings;
create trigger admin_settings_set_updated_at
  before update on public.admin_settings
  for each row execute function public.set_updated_at();

-- Reads one setting with a fallback, so a missing row can never take the site
-- down or, worse, silently start sending mail that was meant to be off.
create or replace function public.get_setting(setting_key text, fallback jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce((select value from public.admin_settings where key = setting_key), fallback);
$$;

create or replace function public.setting_int(setting_key text, fallback integer)
returns integer
language sql
stable
as $$
  select coalesce(nullif(public.get_setting(setting_key, to_jsonb(fallback)) #>> '{}', ''), fallback::text)::integer;
$$;

create or replace function public.setting_bool(setting_key text, fallback boolean)
returns boolean
language sql
stable
as $$
  select coalesce((public.get_setting(setting_key, to_jsonb(fallback)) #>> '{}')::boolean, fallback);
$$;

-- ---------------------------------------------------------------------------
-- admins
--
-- An allowlist. Having a valid Supabase session is not enough to reach the
-- admin panel; the user id must also be a row here. Adding an admin is a
-- deliberate act by an existing admin.
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      citext,
  full_name  text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- Used by nearly every policy in 0009. SECURITY DEFINER so that checking
-- "am I an admin" does not itself require permission to read the admins table,
-- which would be circular.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid() and is_active
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- audit_log
--
-- Anything an admin does to someone else's data leaves a trace. Nobody can
-- edit or delete rows here, including admins.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id           bigserial primary key,
  actor_id     uuid,
  action       text not null,
  target_table text,
  target_id    text,
  payload      jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_target_idx on public.audit_log (target_table, target_id);

create or replace function public.write_audit(
  in_action text,
  in_table text,
  in_target text,
  in_payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, auth
as $$
  insert into public.audit_log (actor_id, action, target_table, target_id, payload)
  values (auth.uid(), in_action, in_table, in_target, in_payload);
$$;
