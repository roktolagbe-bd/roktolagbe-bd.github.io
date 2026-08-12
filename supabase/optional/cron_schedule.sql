-- 0010  Scheduling the email drain
--
-- OPTIONAL. Run this only if you want the queue drained by the database.
--
-- The queue exists so a burst of 25 emails never hits Gmail at once. Something
-- has to empty it on a schedule. There are two ways, pick one:
--
--   A. pg_cron, below. Everything stays inside Supabase.
--   B. The GitHub Actions workflow in .github/workflows/drain-queue.yml,
--      which is disabled by default. Use this if you would rather not enable
--      these extensions.
--
-- Do not run both, or every email gets two attempts at once.
--
-- Before running this file, replace the two placeholders at the bottom:
--   YOUR_PROJECT_REF   the subdomain of your Supabase URL
--   YOUR_DRAIN_SECRET  the same value you put in the DRAIN_SECRET Edge
--                      Function secret
--
-- Note that this is DRAIN_SECRET, not the service_role key. The drain endpoint
-- authorises on that header and nothing else, so there is no reason to put a
-- database key in a cron definition where it would sit in cron.job forever,
-- readable by anyone who can query it.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous schedule so this file is safe to run twice.
do $$
begin
  perform cron.unschedule('drain-email-queue');
exception
  when others then null; -- not scheduled yet, which is fine
end
$$;

-- Every five minutes. Gmail's limit is a daily one, so pace matters more than
-- speed; the cap in admin_settings does the actual protecting.
select cron.schedule(
  'drain-email-queue',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/drain-email-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-drain-secret', 'YOUR_DRAIN_SECRET'
      ),
      body := '{}'::jsonb
    );
  $cron$
);

-- Expire requests nobody could fill, so the landing page counters and the
-- admin queue stay honest. Runs hourly.
--
-- Redundant since 0019: drain-email-queue calls expire_old_requests() on every
-- run, so this happens whichever drainer you use. Harmless to keep — the sweep
-- is idempotent — and it means expiry survives even if the drain endpoint is
-- unreachable for a while.
do $$
begin
  perform cron.unschedule('expire-old-requests');
exception
  when others then null;
end
$$;

select cron.schedule(
  'expire-old-requests',
  '7 * * * *',
  $cron$
    update public.blood_requests
    set status = 'expired'
    where status in ('open', 'matched')
      and needed_by is not null
      and needed_by < now() - interval '6 hours';
  $cron$
);

-- To check what is scheduled:   select * from cron.job;
-- To see recent runs:           select * from cron.job_run_details order by start_time desc limit 20;
