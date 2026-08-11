-- 0004  Blood requests and who was contacted about them
--
-- A blood_request holds the requester's own contact details, which are as
-- private as a donor's. They are shown to a donor only inside the email about
-- that specific request, and on the tokenised response page.

create table if not exists public.blood_requests (
  id                uuid primary key default gen_random_uuid(),

  -- Requester. PRIVATE.
  requester_name    text not null,
  requester_phone   text not null,
  requester_whatsapp text,
  requester_email   citext,

  -- What is needed
  blood_group  public.blood_group not null,
  units_needed integer not null default 1 check (units_needed between 1 and 20),
  urgency      public.urgency_level not null default 'urgent',

  -- Where
  hospital_id            uuid references public.hospitals (id) on delete set null,
  hospital_name_free_text text,
  district_id  integer references public.districts (id) on delete set null,
  upazila_id   integer references public.upazilas (id) on delete set null,
  lat          double precision,
  lng          double precision,

  needed_by    timestamptz,
  patient_note text,

  status       public.request_status not null default 'open',

  -- How far the matcher reached before it stopped expanding.
  match_radius_km integer not null default 5,

  -- Salted hash, never a raw IP. Drives the 3-per-hour cap.
  ip_hash      text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A request must say where it is, one way or another, or nobody can be
  -- matched to it.
  constraint blood_requests_has_location
    check (district_id is not null or (lat is not null and lng is not null)),
  constraint blood_requests_has_hospital
    check (hospital_id is not null or nullif(btrim(coalesce(hospital_name_free_text, '')), '') is not null)
);

create index if not exists blood_requests_status_idx on public.blood_requests (status, created_at desc);
create index if not exists blood_requests_group_idx on public.blood_requests (blood_group, status);
create index if not exists blood_requests_district_idx on public.blood_requests (district_id);
create index if not exists blood_requests_ip_hash_idx on public.blood_requests (ip_hash, created_at);

drop trigger if exists blood_requests_set_updated_at on public.blood_requests;
create trigger blood_requests_set_updated_at
  before update on public.blood_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- request_recipients
--
-- One row per donor we told about one request. This table is the audit trail
-- for "who did we email, and what did they say", and it holds the response
-- token that lets a donor answer without logging in.
-- ---------------------------------------------------------------------------
create table if not exists public.request_recipients (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.blood_requests (id) on delete cascade,
  donor_id     uuid not null references public.donors (id) on delete cascade,

  distance_km  numeric(6, 2),

  email_status public.email_status not null default 'queued',
  sent_at      timestamptz,

  response     public.response_status not null default 'pending',
  -- Single use, tied to one donor and one request. Dies with the request.
  response_token uuid not null default gen_random_uuid(),
  responded_at timestamptz,

  created_at   timestamptz not null default now(),

  -- Never tell the same donor about the same request twice.
  unique (request_id, donor_id)
);

create unique index if not exists request_recipients_token_idx
  on public.request_recipients (response_token);
create index if not exists request_recipients_request_idx
  on public.request_recipients (request_id);
create index if not exists request_recipients_donor_idx
  on public.request_recipients (donor_id, created_at desc);
create index if not exists request_recipients_email_status_idx
  on public.request_recipients (email_status) where email_status = 'queued';

-- When a donor accepts, bump their donation count and start their cooldown
-- only when an admin marks the request fulfilled. Accepting is a promise, not
-- a donation, so this trigger records the promise and nothing more.
create or replace function public.request_recipients_stamp_response()
returns trigger
language plpgsql
as $$
begin
  if new.response is distinct from old.response and new.response <> 'pending' then
    new.responded_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists request_recipients_stamp_response on public.request_recipients;
create trigger request_recipients_stamp_response
  before update on public.request_recipients
  for each row execute function public.request_recipients_stamp_response();

comment on column public.blood_requests.requester_phone is
  'PRIVATE. Shown only to donors who were contacted about this request.';
comment on column public.request_recipients.response_token is
  'Single use. Grants no access beyond answering this one request.';
