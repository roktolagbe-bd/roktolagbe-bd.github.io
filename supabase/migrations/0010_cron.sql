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
--   YOUR_SERVICE_KEY   Project Settings -> API -> service_role
--
-- The service_role key bypasses every security rule in 0009. It belongs here
-- and in Supabase Edge Function secrets. It must never appear in the repo, in
-- a VITE_ variable, or anywhere a browser can reach.

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
        'Authorization', 'Bearer YOUR_SERVICE_KEY'
      ),
      body := '{}'::jsonb
    );
  $cron$
);

-- Expire requests nobody could fill, so the landing page counters and the
-- admin queue stay honest. Runs hourly.
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
