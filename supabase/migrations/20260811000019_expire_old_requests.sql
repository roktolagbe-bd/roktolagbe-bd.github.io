-- 0019  Expiring requests without depending on pg_cron
--
-- There are two ways to drain the email queue, pg_cron or the GitHub Actions
-- workflow, and the project has always said to pick one. What it did not say
-- is that they were never equivalent: supabase/optional/cron_schedule.sql
-- schedules TWO jobs, the drain and an hourly sweep that marks requests
-- 'expired' once their needed_by has passed. The workflow only ever did the
-- first.
--
-- So anyone choosing the workflow — the option that needs no extensions, and
-- therefore the one most people will choose — silently got no expiry at all.
-- Requests for blood that was needed last Tuesday stay 'open' forever, the
-- landing page counts them, and the admin queue fills with things nobody can
-- act on.
--
-- Putting the sweep in a function fixes that for both paths. The drain
-- function calls it on every run, so expiry happens on whatever schedule the
-- drainer runs on, and pg_cron's separate hourly job becomes harmless
-- duplication rather than the only thing keeping the data honest.
--
-- Idempotent by construction: it only touches rows that are still open and
-- already past their deadline, so running it every five minutes costs an index
-- scan and changes nothing on the runs where there is nothing to change.

create or replace function public.expire_old_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer;
begin
  update public.blood_requests
  set status = 'expired'
  where status in ('open', 'matched')
    and needed_by is not null
    -- Six hours of grace. A request needed at 9am is not stale at 9:01, and
    -- somebody may still be on their way.
    and needed_by < now() - interval '6 hours';

  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

-- service_role only. It is a maintenance sweep, not something a visitor has
-- any business triggering.
revoke all on function public.expire_old_requests() from public, anon, authenticated;

comment on function public.expire_old_requests() is
  'Marks open requests expired six hours past needed_by. Called by drain-email-queue on every run, so it does not depend on pg_cron.';

-- Requests without a needed_by are deliberately left alone. "I need blood" with
-- no deadline is not a thing that goes stale on a timer, and guessing one would
-- close requests that are still real.
create index if not exists blood_requests_expiry_idx
  on public.blood_requests (needed_by)
  where status in ('open', 'matched') and needed_by is not null;
