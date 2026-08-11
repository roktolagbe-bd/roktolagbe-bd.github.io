-- 0007  The only things the public may read
--
-- Everything an anonymous visitor can see comes from this file. If a column is
-- not listed in one of these views, no anonymous query can reach it.
--
-- These views are declared `security_invoker = off` (the default for views),
-- so they run with the privileges of their owner and can read the underlying
-- tables even though anon has no grant on them. That is exactly the point: the
-- view is the keyhole, and it is shaped to fit only non-identifying data.
--
-- NOT PRESENT IN ANY VIEW BELOW, and that is deliberate:
--   full_name, phone, whatsapp, email, facebook_url, address_line,
--   lat, lng (true position), date_of_birth, ip_hash, opt_out_token.

-- ---------------------------------------------------------------------------
-- donors_public
--
-- What a search result is allowed to contain: a first name, a blood group, an
-- area, availability, and a fuzzed point. Nothing that identifies or reaches
-- a person.
-- ---------------------------------------------------------------------------
drop view if exists public.donors_public cascade;
create view public.donors_public as
select
  d.id,
  d.display_name,
  d.blood_group,
  d.district_id,
  du.name_en as district_en,
  du.name_bn as district_bn,
  d.upazila_id,
  u.name_en as upazila_en,
  u.name_bn as upazila_bn,

  -- The fuzzed point only. The true one never appears in a view.
  d.lat_fuzzed,
  d.lng_fuzzed,

  d.verified,
  d.total_donations,

  -- Computed live against the current cooldown setting rather than frozen
  -- into the row. See the note in 0003.
  (
    d.last_donation_date is null
    or d.last_donation_date + (public.setting_int('donor_cooldown_days', 120) || ' days')::interval
       <= now()
  ) as is_available,

  -- Month precision. The exact date of a donation is a movement record.
  to_char(d.last_donation_date, 'YYYY-MM') as last_donation_month
from public.donors d
left join public.districts du on du.id = d.district_id
left join public.upazilas u on u.id = d.upazila_id
where not d.blocked
  and d.consent_public_listing;

-- ---------------------------------------------------------------------------
-- wall_of_donors
--
-- The social proof page. Same consent gate, ordered so that showing up feels
-- like something worth doing.
-- ---------------------------------------------------------------------------
drop view if exists public.wall_of_donors cascade;
create view public.wall_of_donors as
select
  d.id,
  d.display_name,
  d.blood_group,
  du.name_en as district_en,
  du.name_bn as district_bn,
  d.total_donations,
  d.verified,
  date_trunc('month', d.created_at)::date as joined_month
from public.donors d
left join public.districts du on du.id = d.district_id
where d.consent_public_listing
  and not d.blocked
order by d.total_donations desc, d.created_at asc;

-- ---------------------------------------------------------------------------
-- Landing page counters
--
-- Aggregates only. Note that these count ALL donors, including those who did
-- not consent to public listing: a count is not personal data, and the number
-- of people who signed up is the honest number. No row is identifiable.
-- ---------------------------------------------------------------------------
drop view if exists public.public_stats cascade;
create view public.public_stats as
select 'donors_total' as metric, count(*)::bigint as value
from public.donors where not blocked
union all
select 'requests_fulfilled', count(*)::bigint
from public.blood_requests where status = 'fulfilled'
union all
select 'districts_covered', count(distinct district_id)::bigint
from public.donors where not blocked and district_id is not null;

-- ---------------------------------------------------------------------------
-- The blood grid on the landing page
--
-- Availability per group, across every donor, not just the publicly listed
-- ones. This is what makes the eight tiles a live object.
-- ---------------------------------------------------------------------------
drop view if exists public.public_group_availability cascade;
create view public.public_group_availability as
select
  d.blood_group,
  count(*) filter (
    where d.last_donation_date is null
       or d.last_donation_date + (public.setting_int('donor_cooldown_days', 120) || ' days')::interval <= now()
  )::bigint as available,
  count(*)::bigint as total
from public.donors d
where not d.blocked
group by d.blood_group;

-- ---------------------------------------------------------------------------
-- Hospitals and places, for the dropdowns
-- ---------------------------------------------------------------------------
drop view if exists public.hospitals_public cascade;
create view public.hospitals_public as
select id, name_en, name_bn, district_id, upazila_id, address, phone, lat, lng
from public.hospitals
where is_active;

comment on view public.donors_public is
  'The ONLY donor data anonymous visitors can read. No contact columns, fuzzed position only.';
