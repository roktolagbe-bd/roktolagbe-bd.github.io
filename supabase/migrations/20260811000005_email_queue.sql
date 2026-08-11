-- 0005  Email queue
--
-- Nothing sends mail directly. Everything is written here first and drained on
-- a schedule, because free Gmail allows roughly 500 recipients a day and a
-- burst of 25 emails the moment someone hits submit is how an account gets
-- locked. The queue is also what makes retries and a daily cap possible.

create table if not exists public.email_queue (
  id            uuid primary key default gen_random_uuid(),
  to_email      citext not null,
  subject       text not null,
  html_body     text not null,
  text_body     text not null, -- Gmail on Android needs the plain part

  attempts      integer not null default 0,
  status        public.email_status not null default 'queued',
  last_error    text,

  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz,

  -- What this email is about, so admin can trace a failure back to a request
  -- and so a retry can be attributed.
  request_id    uuid references public.blood_requests (id) on delete set null,
  recipient_id  uuid references public.request_recipients (id) on delete set null,
  kind          text not null default 'donor_request',

  created_at    timestamptz not null default now(),

  constraint email_queue_attempts_sane check (attempts >= 0 and attempts <= 10)
);

-- The drain function's hot path: what is due, oldest first.
create index if not exists email_queue_due_idx
  on public.email_queue (scheduled_for)
  where status = 'queued';

create index if not exists email_queue_status_idx on public.email_queue (status, created_at desc);
create index if not exists email_queue_sent_at_idx on public.email_queue (sent_at)
  where status = 'sent';

comment on table public.email_queue is
  'Outbound mail. Drained by the drain-email-queue Edge Function, never by the browser.';
comment on column public.email_queue.attempts is
  'Three tries with backoff, then marked failed and surfaced in the admin panel.';
