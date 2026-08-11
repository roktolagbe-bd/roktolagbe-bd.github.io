-- Seed: admin settings
--
-- Safe to run more than once. Existing values are left alone, so re-running
-- this after you have changed a setting in the admin panel will not undo it.

insert into public.admin_settings (key, value, description) values
  (
    'auto_email_enabled',
    'false'::jsonb,
    'Master switch. When false, matching still runs and recipients are recorded with status skipped, but no email is queued. Starts OFF on purpose: turn it on when you have checked the templates and the Gmail App Password.'
  ),
  (
    'sender_name',
    '"রক্ত লাগবে"'::jsonb,
    'The From name on every outgoing email.'
  ),
  (
    'match_radius_steps',
    '[5, 10, 25, 50]'::jsonb,
    'Kilometres. The matcher tries each in order until it finds enough donors, then falls back to the whole district.'
  ),
  (
    'min_donors_per_step',
    '10'::jsonb,
    'If a radius finds fewer available donors than this, widen to the next step.'
  ),
  (
    'donor_cooldown_days',
    '120'::jsonb,
    'Days after a donation before a donor counts as available again.'
  ),
  (
    'max_emails_per_request',
    '25'::jsonb,
    'Never contact more than this many donors about a single request.'
  ),
  (
    'daily_email_cap',
    '400'::jsonb,
    'Stop sending after this many emails in a day. Free Gmail allows roughly 500; this leaves headroom.'
  ),
  (
    'max_requests_per_ip_per_hour',
    '3'::jsonb,
    'Enforced by a trigger on blood_requests. Keyed on a salted hash, never a raw IP.'
  ),
  (
    'max_registrations_per_ip_per_hour',
    '3'::jsonb,
    'Enforced by a trigger on donors.'
  ),
  (
    'min_form_seconds',
    '4'::jsonb,
    'A form submitted faster than this was not filled in by a person.'
  )
on conflict (key) do nothing;
