-- Did the last blood request actually work?
--
-- One query. Paste into the Supabase SQL editor and run. Read-only.
--
-- Every failure this project has had in production was the same shape: one
-- component reported success, a later one did nothing, and nothing looked at
-- the join between them. Reading return values cannot catch that, because the
-- return value is the thing that is wrong. This reads the tables afterwards.
--
-- For a specific request, put its id in place of null.

select stage, case when ok then 'ok' else 'FAIL' end as verdict, detail
from public.request_pipeline_health(null);


-- What each stage means when it fails
--
--   origin      The request has neither a map pin nor a district centre, so
--               the matcher raises. Nobody will ever be matched to it.
--
--   matched     No recipients were recorded. The 'why not' row below it says
--               whether that is because no donor of that group exists, or
--               because the ones who do have no email address and therefore
--               cannot be contacted at all.
--
--   enqueued    THE ONE THAT MATTERS MOST. Recipients marked 'queued' with
--               nothing in email_queue means the matcher ran and
--               send-request-emails did not, or failed after it. Nothing in
--               the database writes to email_queue — only that Edge Function
--               does — so an empty queue never means "sending is broken", it
--               means nothing was ever enqueued.
--
--   delivered   Rows reached the queue but the drainer has not sent them.
--               Check the Actions run, and GMAIL_USER / GMAIL_APP_PASSWORD.


-- ---------------------------------------------------------------------------
-- Fixing what it finds
-- ---------------------------------------------------------------------------

-- Recipients recorded but nothing enqueued: re-run send-request-emails for the
-- request. Safe to repeat; the unique index on (recipient_id, kind) makes the
-- queue insert idempotent. Replace REF and DRAIN_SECRET.
--
--   curl -X POST "https://REF.supabase.co/functions/v1/send-request-emails" \
--     -H "Content-Type: application/json" \
--     -d '{"request_id":"THE-REQUEST-ID"}'

-- Never matched at all: re-run the matcher. Safe to repeat; it skips donors
-- already recorded against the request.
--
-- select * from public.run_request_matcher('THE-REQUEST-ID');

-- Everything, for every open request that has no recipients:
--
-- select r.id, m.*
-- from public.blood_requests r
-- cross join lateral public.run_request_matcher(r.id) m
-- where r.status = 'open'
--   and not exists (select 1 from public.request_recipients rr where rr.request_id = r.id);
