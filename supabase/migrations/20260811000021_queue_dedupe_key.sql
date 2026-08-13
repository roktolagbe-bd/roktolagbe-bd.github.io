-- 0021  An ON CONFLICT target that Postgres can actually use
--
--   send-request-emails failed { code: "42P10",
--     message: "there is no unique or exclusion constraint matching the
--               ON CONFLICT specification" }
--
-- 0012 gave email_queue two unique indexes, and made both of them PARTIAL:
--
--   email_queue_recipient_kind_idx  on (recipient_id, kind)
--     where recipient_id is not null
--   email_queue_request_kind_idx    on (request_id, kind)
--     where recipient_id is null and request_id is not null
--
-- A partial unique index can only arbitrate an ON CONFLICT when the statement
-- repeats the index's WHERE clause. PostgREST's `on_conflict=` parameter emits
-- a bare `ON CONFLICT (cols)` with no predicate, so Postgres cannot match
-- either index and raises 42P10 before writing anything.
--
-- Both upserts in send-request-emails hit this, so the function died on the
-- first one. That is why email_queue was empty while request_recipients said
-- 'queued': the matcher runs earlier in the same function and had already
-- committed its rows.
--
-- Reproduced against a real Postgres before writing this, with the exact
-- statements PostgREST generates. Both raise 42P10.
--
-- The fix is one non-partial unique index over a generated column that encodes
-- the same rule the two partial indexes encoded between them:
--
--   one email of each kind per recipient row      -> r:<recipient_id>|<kind>
--   one of each kind per request without one      -> q:<request_id>|<kind>
--   anything else                                 -> null, never deduplicated
--
-- Null is right for the third case. certificate_link mail belongs to neither a
-- recipient nor a request, and nulls are distinct in a unique index, so those
-- rows simply never collide. Their own rate limit lives in
-- certificate_link_recently_sent.

alter table public.email_queue
  add column if not exists dedupe_key text
  generated always as (
    case
      when recipient_id is not null then 'r:' || recipient_id::text || '|' || kind
      when request_id is not null then 'q:' || request_id::text || '|' || kind
      else null
    end
  ) stored;

comment on column public.email_queue.dedupe_key is
  'Generated. The ON CONFLICT arbiter for every queue upsert. Null means "this row is not deduplicated", which is correct for mail belonging to neither a recipient nor a request.';

-- Non-partial, so `on conflict (dedupe_key)` is a legal arbiter.
create unique index if not exists email_queue_dedupe_idx
  on public.email_queue (dedupe_key);

-- The old indexes stay. They still enforce exactly the same rule, they are
-- what the drainer's lookups use, and dropping working constraints to tidy up
-- after a bug is how the next bug gets in.

-- ---------------------------------------------------------------------------
-- Prove the arbiter works, at migration time
--
-- This is exactly the sort of claim that gets asserted in a comment and turns
-- out to be false. It is checked instead, using EXPLAIN: planning an INSERT
-- raises 42P10 when no usable arbiter exists, and writes nothing when one
-- does. So this fails the migration rather than production if the index is
-- ever made partial again.
-- ---------------------------------------------------------------------------
do $$
begin
  execute $probe$
    explain (costs off)
    insert into public.email_queue (to_email, subject, html_body, text_body, kind)
    values ('probe@example.invalid', 'probe', '<p>probe</p>', 'probe', 'donor_request')
    on conflict (dedupe_key) do nothing
  $probe$;
exception
  when others then
    raise exception
      'email_queue has no usable ON CONFLICT arbiter for dedupe_key (%). '
      'Every queue upsert would fail with 42P10, exactly as it did before this migration.',
      sqlerrm;
end
$$;

-- The dedupe rule itself is verified in scripts/diagnostics/, not here: a
-- check written in the same file as the thing it checks tends to agree with
-- it by construction, which is how the last three bugs passed review.

-- ---------------------------------------------------------------------------
-- The health check was crying wolf
--
-- 0020's `consistent` stage compared every email_queue row for a request
-- against the number of recipients, and failed whenever both were correct: a
-- request with one donor and a requester confirmation has one recipient and
-- TWO queue rows. The confirmation is addressed to the requester and has no
-- recipient row by design.
--
-- A check that reports a problem when there is none is worse than no check.
-- It is the same failure as everything else this week — reporting something
-- other than what is true — and it would have taught its reader to skip that
-- line, which is where the real one eventually hides.
--
-- Counting is now per kind, which is also more useful: donor mail and the
-- requester's confirmation fail for different reasons.
-- ---------------------------------------------------------------------------
create or replace function public.request_pipeline_health(in_request_id uuid default null)
returns table (
  stage text,
  ok boolean,
  detail text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  req record;
  recipients integer;
  queued_recipients integer;
  skipped_recipients integer;
  donor_rows integer;
  confirm_rows integer;
  sent_rows integer;
  failed_rows integer;
  waiting_rows integer;
  auto_email boolean := public.setting_bool('auto_email_enabled', false);
  reachable integer;
  unreachable integer;
begin
  select r.*, d.lat as district_lat, d.lng as district_lng
  into req
  from public.blood_requests r
  left join public.districts d on d.id = r.district_id
  where (in_request_id is null or r.id = in_request_id)
  order by r.created_at desc
  limit 1;

  if req.id is null then
    return query select 'request'::text, false, 'No request found. Send one first.'::text;
    return;
  end if;

  return query select 'request'::text, true,
    format('%s, %s, created %s', req.blood_group,
           coalesce(req.hospital_name_free_text, '(no hospital name)'),
           to_char(req.created_at, 'YYYY-MM-DD HH24:MI'));

  -- 1. Can the matcher even start?
  return query select 'origin'::text,
    coalesce(req.lat, req.district_lat) is not null,
    case
      when req.lat is not null then format('map pin at %s, %s', round(req.lat::numeric,4), round(req.lng::numeric,4))
      when req.district_lat is not null then 'district centre (no map pin on this request)'
      else 'NO USABLE LOCATION: the matcher raises on this request'
    end;

  -- 2. Did matching actually record anybody?
  select count(*) into recipients from public.request_recipients where request_id = req.id;
  select count(*) into queued_recipients from public.request_recipients
    where request_id = req.id and email_status = 'queued';
  select count(*) into skipped_recipients from public.request_recipients
    where request_id = req.id and email_status = 'skipped';

  return query select 'matched'::text, recipients > 0,
    format('%s recipient(s) recorded: %s queued, %s skipped', recipients, queued_recipients, skipped_recipients);

  if recipients = 0 then
    select count(*) into reachable
    from public.donors d
    where d.blood_group = req.blood_group and not d.blocked and d.deleted_at is null
      and d.consent_email and d.email is not null;
    select count(*) into unreachable
    from public.donors d
    where d.blood_group = req.blood_group and not d.blocked and d.deleted_at is null
      and (d.email is null or not d.consent_email);

    return query select 'why not'::text, false,
      format('%s contactable donor(s) of this group exist anywhere, and %s more have no email address so cannot be told at all',
             reachable, unreachable);
  end if;

  return query select 'auto_email_enabled'::text, auto_email,
    case when auto_email then 'on: recipients are recorded as queued'
         else 'OFF: recipients are recorded as skipped and nothing will ever be queued' end;

  -- 3. Donor mail. This is the check that caught 42P10.
  select count(*) into donor_rows
  from public.email_queue where request_id = req.id and kind = 'donor_request';

  return query select 'donor mail queued'::text,
    (queued_recipients = 0 or donor_rows >= queued_recipients),
    case
      when queued_recipients > 0 and donor_rows = 0 then
        format('BROKEN: %s recipient(s) marked queued but 0 donor emails in email_queue. '
               || 'The matcher ran and send-request-emails did not, or failed after it. '
               || 'Nothing in the database writes to email_queue.', queued_recipients)
      when queued_recipients = 0 then 'nothing was due to be queued'
      else format('%s of %s donor email(s) queued', donor_rows, queued_recipients)
    end;

  -- 4. The requester's own confirmation, which has no recipient row and so
  --    must be counted separately rather than treated as a surplus.
  select count(*) into confirm_rows
  from public.email_queue where request_id = req.id and kind = 'requester_confirmation';

  return query select 'requester confirmation'::text,
    (req.requester_email is null or confirm_rows > 0),
    case
      when req.requester_email is null then 'no email address given, so none is due'
      when confirm_rows = 0 then 'not queued. The donors may still have been; check the function logs.'
      else 'queued'
    end;

  -- 5. Did the drainer do its job?
  select count(*) into sent_rows from public.email_queue
    where request_id = req.id and status = 'sent';
  select count(*) into failed_rows from public.email_queue
    where request_id = req.id and status = 'failed';
  select count(*) into waiting_rows from public.email_queue
    where request_id = req.id and status = 'queued';

  if donor_rows + confirm_rows > 0 then
    return query select 'delivered'::text,
      -- Waiting is not failing. The drainer runs on a schedule, and GitHub's
      -- can be an hour late, so a fresh request being unsent is expected.
      (failed_rows = 0),
      format('%s sent, %s failed, %s waiting for the drainer', sent_rows, failed_rows, waiting_rows);
  end if;
end;
$$;

revoke all on function public.request_pipeline_health(uuid) from public, anon;
grant execute on function public.request_pipeline_health(uuid) to authenticated;
