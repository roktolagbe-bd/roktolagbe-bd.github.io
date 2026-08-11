-- 0009  Row Level Security
--
-- This is the file that protects real people. Everything else is convenience.
--
-- The model in one paragraph: RLS is ON for every table, and no table has a
-- SELECT policy for anon. Anonymous visitors read through the views in 0007,
-- which contain no contact columns, and through the SECURITY DEFINER functions
-- in 0008, which return only what the caller is entitled to. Anon may INSERT
-- into donors and blood_requests and nothing else. Admins, checked against the
-- allowlist by is_admin(), may read and write everything.
--
-- If you are adding a table, the default is: enable RLS, add no anon policy,
-- and expose whatever the public genuinely needs through a view.
--
-- To sanity check this after running it, see the query at the bottom of the
-- file: it lists every table with RLS off, which should return zero rows.

-- ---------------------------------------------------------------------------
-- Turn RLS on everywhere. With RLS on and no policy, the table is closed.
-- ---------------------------------------------------------------------------
alter table public.donors             enable row level security;
alter table public.blood_requests     enable row level security;
alter table public.request_recipients enable row level security;
alter table public.email_queue        enable row level security;
alter table public.districts          enable row level security;
alter table public.upazilas           enable row level security;
alter table public.hospitals          enable row level security;
alter table public.geocode_cache      enable row level security;
alter table public.admin_settings     enable row level security;
alter table public.admins             enable row level security;
alter table public.audit_log          enable row level security;

-- Force RLS even for the table owner, so a mistake in a SECURITY DEFINER
-- function cannot quietly bypass the whole model.
alter table public.donors             force row level security;
alter table public.blood_requests     force row level security;
alter table public.request_recipients force row level security;

-- ---------------------------------------------------------------------------
-- donors
--
-- anon: INSERT only. Registration is open to the world; reading is not.
-- There is deliberately no anon SELECT policy, so `select * from donors`
-- returns zero rows no matter how the query is written.
-- ---------------------------------------------------------------------------
drop policy if exists donors_anon_insert on public.donors;
create policy donors_anon_insert on public.donors
  for insert to anon, authenticated
  with check (
    -- A registration cannot arrive pre-verified or pre-blocked, and cannot
    -- claim a donation history. Those are ours to set, not the visitor's.
    verified = false
    and blocked = false
    and total_donations = 0
  );

drop policy if exists donors_admin_all on public.donors;
create policy donors_admin_all on public.donors
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- blood_requests
--
-- anon: INSERT only, and the row must start life as 'open'. Nobody can create
-- a request that is already fulfilled, or backdate one.
-- ---------------------------------------------------------------------------
drop policy if exists blood_requests_anon_insert on public.blood_requests;
create policy blood_requests_anon_insert on public.blood_requests
  for insert to anon, authenticated
  with check (status = 'open');

drop policy if exists blood_requests_admin_all on public.blood_requests;
create policy blood_requests_admin_all on public.blood_requests
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- request_recipients
--
-- No anon access at all. Donors answer through respond_to_request(), which is
-- SECURITY DEFINER and checks the token. Letting anon read this table would
-- expose who was asked about which request.
-- ---------------------------------------------------------------------------
drop policy if exists request_recipients_admin_all on public.request_recipients;
create policy request_recipients_admin_all on public.request_recipients
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- email_queue
--
-- Contains rendered emails, which contain phone numbers. Admin only. The Edge
-- Functions reach it as service_role, which bypasses RLS by design.
-- ---------------------------------------------------------------------------
drop policy if exists email_queue_admin_all on public.email_queue;
create policy email_queue_admin_all on public.email_queue
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Reference data: districts, upazilas, hospitals
--
-- Public read. These are places, not people. Write is admin only.
-- ---------------------------------------------------------------------------
drop policy if exists districts_read on public.districts;
create policy districts_read on public.districts
  for select to anon, authenticated using (true);

drop policy if exists districts_admin_write on public.districts;
create policy districts_admin_write on public.districts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists upazilas_read on public.upazilas;
create policy upazilas_read on public.upazilas
  for select to anon, authenticated using (true);

drop policy if exists upazilas_admin_write on public.upazilas;
create policy upazilas_admin_write on public.upazilas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists hospitals_read on public.hospitals;
create policy hospitals_read on public.hospitals
  for select to anon, authenticated using (is_active);

drop policy if exists hospitals_admin_write on public.hospitals;
create policy hospitals_admin_write on public.hospitals
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- geocode_cache
--
-- No public access. A cache of resolved addresses is a record of where people
-- have been looking, which is worth protecting even though it holds no names.
-- Written by the geocode Edge Function as service_role.
-- ---------------------------------------------------------------------------
drop policy if exists geocode_cache_admin_all on public.geocode_cache;
create policy geocode_cache_admin_all on public.geocode_cache
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- admin_settings, admins, audit_log
-- ---------------------------------------------------------------------------
drop policy if exists admin_settings_admin_all on public.admin_settings;
create policy admin_settings_admin_all on public.admin_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- An admin may see the allowlist. Only an existing admin may change it.
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins
  for select to authenticated using (public.is_admin());

drop policy if exists admins_write on public.admins;
create policy admins_write on public.admins
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admins may read the audit log. Nobody may edit or delete it, including
-- admins: there is no UPDATE or DELETE policy, and that is intentional.
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Grants
--
-- RLS decides which rows. Grants decide which tables can be named at all.
-- Both are needed: revoking the grant means a mistake in a policy still fails
-- closed.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

grant select on public.districts, public.upazilas, public.hospitals to anon, authenticated;
grant insert on public.donors, public.blood_requests to anon, authenticated;

-- The views are the public API surface.
grant select on
  public.donors_public,
  public.wall_of_donors,
  public.public_stats,
  public.public_group_availability,
  public.hospitals_public
to anon, authenticated;

-- Sequences anon needs for its two inserts.
grant usage on all sequences in schema public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verify
--
-- Run these after applying. The first must return zero rows. The second must
-- show no contact columns.
--
--   select tablename from pg_tables t
--   where schemaname = 'public'
--     and not exists (
--       select 1 from pg_class c
--       where c.relname = t.tablename and c.relrowsecurity
--     );
--
--   select column_name from information_schema.columns
--   where table_name = 'donors_public';
--
-- And as a final check, from the browser with the anon key:
--   supabase.from('donors').select('phone')   -> must return no rows
-- ---------------------------------------------------------------------------
