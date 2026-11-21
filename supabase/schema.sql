-- =====================================================================
-- HBDYWI Reader Funnel — Supabase / Postgres schema
-- Run once in Supabase → SQL Editor (safe to re-run: uses IF NOT EXISTS
-- / CREATE OR REPLACE). All access goes through Cloudflare Functions
-- using the service-role key; RLS is ON with no public policies, so the
-- anon key can read nothing.
-- =====================================================================

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ---------- helpers ----------
create or replace function short_code(n int default 6) returns text
language sql volatile as $$
  -- no 0/O/1/I to avoid confusion when people type the code
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random()*32)::int, 1), '')
  from generate_series(1, n)
$$;

create or replace function secret_token() returns text
language sql volatile as $$ select encode(gen_random_bytes(24), 'hex') $$;

-- ---------- settings (everything the admin can edit without a rebuild) ----------
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- books (future volumes reuse the same structure) ----------
create table if not exists books (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,              -- e.g. 'volume-one'
  volume      int  not null default 1,
  title       text not null,
  subtitle    text,
  promise     text,                              -- one-line book promise
  cover_url   text,
  amazon      jsonb not null default '{}'::jsonb,-- {"paperback": url, "kindle": url, "hardcover": url}
  is_current  boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index if not exists books_one_current on books (is_current) where is_current;

-- ---------- contacts (one row per person, keyed on email, case-insensitive) ----------
create table if not exists contacts (
  id               uuid primary key default gen_random_uuid(),
  email            citext unique not null,
  first_name       text,
  last_name        text,
  marketing_opt_in boolean not null default false,  -- book / cohort / Bloom Project updates
  opt_in_at        timestamptz,
  opt_in_source    text,
  unsubscribed_at  timestamptz,                     -- stops ALL non-essential follow-ups
  unsub_token      text unique not null default secret_token(),
  amazon_clicked_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function upsert_contact(p_email text, p_first text, p_last text, p_opt_in boolean, p_source text)
returns contacts language plpgsql as $$
declare c contacts;
begin
  insert into contacts (email, first_name, last_name, marketing_opt_in, opt_in_at, opt_in_source)
  values (lower(trim(p_email)), nullif(trim(p_first),''), nullif(trim(p_last),''),
          coalesce(p_opt_in,false), case when p_opt_in then now() end, case when p_opt_in then p_source end)
  on conflict (email) do update set
    first_name       = coalesce(nullif(trim(p_first),''), contacts.first_name),
    last_name        = coalesce(nullif(trim(p_last),''),  contacts.last_name),
    -- a form can only ADD consent; removing it happens via unsubscribe
    marketing_opt_in = contacts.marketing_opt_in or coalesce(p_opt_in,false),
    opt_in_at        = case when p_opt_in and not contacts.marketing_opt_in then now() else contacts.opt_in_at end,
    opt_in_source    = case when p_opt_in and not contacts.marketing_opt_in then p_source else contacts.opt_in_source end,
    unsubscribed_at  = case when p_opt_in then null else contacts.unsubscribed_at end,
    updated_at       = now()
  returning * into c;
  return c;
end $$;

-- ---------- free activation ----------
create table if not exists activation_sessions (
  id           uuid primary key default gen_random_uuid(),
  starts_at    timestamptz not null unique,
  duration_min int  not null default 45,
  zoom_url     text,                 -- null → use settings.activation.default_zoom_url
  capacity     int,                  -- null → unlimited (Zoom plan limit applies)
  status       text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  auto_created boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists activation_registrations (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references activation_sessions(id) on delete cascade,
  contact_id  uuid not null references contacts(id) on delete cascade,
  attended    boolean,
  created_at  timestamptz not null default now(),
  unique (session_id, contact_id)
);

create or replace function register_activation(p_session uuid, p_email text, p_first text, p_last text, p_opt_in boolean)
returns jsonb language plpgsql as $$
declare s activation_sessions; c contacts; r activation_registrations; n int; existed boolean := false;
begin
  select * into s from activation_sessions where id = p_session for update;
  if not found or s.status <> 'scheduled' or s.starts_at <= now() then
    return jsonb_build_object('error','session_unavailable');
  end if;
  c := upsert_contact(p_email, p_first, p_last, p_opt_in, 'activation');
  select * into r from activation_registrations where session_id = s.id and contact_id = c.id;
  if found then existed := true;
  else
    if s.capacity is not null then
      select count(*) into n from activation_registrations where session_id = s.id;
      if n >= s.capacity then return jsonb_build_object('error','session_full'); end if;
    end if;
    insert into activation_registrations (session_id, contact_id) values (s.id, c.id) returning * into r;
  end if;
  return jsonb_build_object('registration_id', r.id, 'contact_id', c.id, 'already_registered', existed,
                            'unsub_token', c.unsub_token);
end $$;

-- ---------- paid guided cohort ----------
create table if not exists cohorts (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid references books(id),
  name          text not null,                     -- e.g. 'January 2027 Cohort'
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  schedule_text text,                              -- human summary: 'Tuesdays 6 PM PT, 6 weeks'
  meeting_times jsonb not null default '[]'::jsonb,-- ["2027-01-12T02:00:00Z", ...] (UTC ISO)
  meeting_minutes int not null default 60,
  timezone      text not null default 'America/Los_Angeles',
  zoom_url      text,
  workbook_url  text,
  instructions  text,
  price_cents   int  not null default 7200,
  currency      text not null default 'usd',
  capacity      int  not null default 20,
  status        text not null default 'open' check (status in ('draft','open','closed','completed')),
  created_at    timestamptz not null default now()
);

create table if not exists cohort_enrollments (
  id               uuid primary key default gen_random_uuid(),
  cohort_id        uuid not null references cohorts(id) on delete cascade,
  contact_id       uuid not null references contacts(id) on delete cascade,
  status           text not null default 'pending' check (status in ('pending','paid','refunded','expired')),
  stripe_session_id text unique,
  stripe_payment_intent text,
  amount_cents     int,
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (cohort_id, contact_id)
);

create table if not exists waitlist (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  book_id     uuid references books(id),
  notified_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (contact_id, book_id)
);

-- Reserve a seat (pending) before sending the buyer to Stripe. Pending seats
-- hold capacity for 35 min (Stripe Checkout session expires at 30).
create or replace function reserve_cohort_seat(p_cohort uuid, p_email text, p_first text, p_last text, p_opt_in boolean)
returns jsonb language plpgsql as $$
declare co cohorts; c contacts; e cohort_enrollments; taken int;
begin
  select * into co from cohorts where id = p_cohort for update;
  if not found or co.status <> 'open' or co.starts_at <= now() then return jsonb_build_object('error','closed'); end if;
  c := upsert_contact(p_email, p_first, p_last, p_opt_in, 'cohort');
  select * into e from cohort_enrollments where cohort_id = co.id and contact_id = c.id;
  if found and e.status = 'paid' then return jsonb_build_object('error','already_enrolled'); end if;
  select count(*) into taken from cohort_enrollments
   where cohort_id = co.id and contact_id <> c.id
     and (status = 'paid' or (status = 'pending' and created_at > now() - interval '35 minutes'));
  if taken >= co.capacity then return jsonb_build_object('error','full'); end if;
  insert into cohort_enrollments (cohort_id, contact_id, status, created_at)
  values (co.id, c.id, 'pending', now())
  on conflict (cohort_id, contact_id) do update set status = 'pending', created_at = now(), updated_at = now()
  returning * into e;
  return jsonb_build_object('enrollment_id', e.id, 'contact_id', c.id, 'email', c.email,
                            'price_cents', co.price_cents, 'currency', co.currency, 'cohort_name', co.name);
end $$;

-- ---------- independent groups ----------
create table if not exists groups (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid references books(id),
  name            text not null,
  leader_contact_id uuid not null references contacts(id),
  invite_code     text unique not null default short_code(6),   -- public: /j/ABC123
  leader_token    text unique not null default secret_token(),  -- private: dashboard + booking
  start_date      date,
  end_date        date,
  meeting_day     text,
  meeting_time    text,          -- 'HH:MM' local to timezone
  frequency       text,          -- weekly / biweekly / monthly / other
  timezone        text not null default 'America/Los_Angeles',
  est_size        int,           -- planning only, never used for eligibility
  member_count    int not null default 0,
  eligible_at     timestamptz,   -- set exactly once when member_count first reaches threshold
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists group_members (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references groups(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  email        citext not null,
  first_name   text not null,
  last_name    text not null,
  purchased    boolean not null,              -- self-reported
  member_token text unique not null default secret_token(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (group_id, contact_id)
);
-- belt and braces: the same email can never count twice in one group
create unique index if not exists group_members_group_email on group_members (group_id, lower(email::text));

create or replace function create_group(p_email text, p_first text, p_last text, p_name text, p_book uuid,
  p_start date, p_end date, p_day text, p_time text, p_freq text, p_tz text, p_est int, p_opt_in boolean)
returns jsonb language plpgsql as $$
declare c contacts; g groups; tries int := 0;
begin
  c := upsert_contact(p_email, p_first, p_last, p_opt_in, 'group_leader');
  loop
    begin
      insert into groups (book_id, name, leader_contact_id, start_date, end_date, meeting_day, meeting_time,
                          frequency, timezone, est_size)
      values (p_book, trim(p_name), c.id, p_start, p_end, p_day, p_time, p_freq, coalesce(nullif(p_tz,''),'America/Los_Angeles'), p_est)
      returning * into g;
      exit;
    exception when unique_violation then
      tries := tries + 1; if tries > 5 then raise; end if;   -- invite_code collision, retry
    end;
  end loop;
  return jsonb_build_object('group_id', g.id, 'invite_code', g.invite_code, 'leader_token', g.leader_token,
                            'contact_id', c.id);
end $$;

-- Atomic join: row-locks the group, so concurrent joins serialize, the count
-- is exact, and eligible_at is set by exactly one transaction.
create or replace function join_group(p_code text, p_email text, p_first text, p_last text, p_purchased boolean, p_opt_in boolean)
returns jsonb language plpgsql as $$
declare g groups; c contacts; m group_members; existed boolean := false; cnt int; threshold int; unlocked boolean := false;
begin
  select * into g from groups where invite_code = upper(trim(p_code)) for update;
  if not found then return jsonb_build_object('error','group_not_found'); end if;
  select coalesce((value->>'threshold')::int, 5) into threshold from settings where key = 'visit';
  threshold := coalesce(threshold, 5);
  c := upsert_contact(p_email, p_first, p_last, p_opt_in, 'group_member');
  select * into m from group_members where group_id = g.id and contact_id = c.id;
  if found then
    existed := true;
    update group_members set purchased = p_purchased, first_name = trim(p_first), last_name = trim(p_last), updated_at = now()
     where id = m.id returning * into m;
  else
    insert into group_members (group_id, contact_id, email, first_name, last_name, purchased)
    values (g.id, c.id, c.email, trim(p_first), trim(p_last), p_purchased) returning * into m;
  end if;
  select count(*) into cnt from group_members where group_id = g.id;
  update groups set member_count = cnt, updated_at = now() where id = g.id;
  if cnt >= threshold and g.eligible_at is null then
    update groups set eligible_at = now() where id = g.id and eligible_at is null;
    unlocked := true;
  end if;
  return jsonb_build_object('group_id', g.id, 'group_name', g.name, 'member_id', m.id, 'member_token', m.member_token,
    'already_member', existed, 'member_count', cnt, 'threshold', threshold, 'just_unlocked', unlocked,
    'leader_contact_id', g.leader_contact_id, 'unsub_token', c.unsub_token);
end $$;

-- ---------- virtual author visit (max ONE per group: unique group_id) ----------
create table if not exists author_visits (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null unique references groups(id) on delete cascade,
  starts_at      timestamptz not null,
  duration_min   int not null default 30,
  status         text not null default 'booked' check (status in ('booked','cancelled','completed')),
  zoom_meeting_id text,
  zoom_join_url  text,
  reschedule_count int not null default 0,
  ics_sequence   int not null default 0,
  booked_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- Imani can't be double-booked
create unique index if not exists author_visits_slot on author_visits (starts_at) where status = 'booked';

create table if not exists visit_blackouts (
  id     uuid primary key default gen_random_uuid(),
  day    date not null unique,       -- in the author's timezone
  note   text
);

-- Book or reschedule. Never creates a second visit for a group.
create or replace function book_visit(p_token text, p_starts timestamptz, p_minutes int)
returns jsonb language plpgsql as $$
declare g groups; v author_visits; prev timestamptz; is_resched boolean := false;
begin
  select * into g from groups where leader_token = p_token for update;
  if not found then return jsonb_build_object('error','group_not_found'); end if;
  if g.eligible_at is null then return jsonb_build_object('error','not_eligible'); end if;
  select * into v from author_visits where group_id = g.id for update;
  if found then
    if v.status = 'completed' then return jsonb_build_object('error','visit_used'); end if;
    prev := v.starts_at; is_resched := (v.status = 'booked');
    begin
      update author_visits set starts_at = p_starts, duration_min = p_minutes, status = 'booked',
        reschedule_count = reschedule_count + case when is_resched then 1 else 0 end,
        ics_sequence = ics_sequence + 1, updated_at = now()
      where id = v.id returning * into v;
    exception when unique_violation then return jsonb_build_object('error','slot_taken'); end;
  else
    begin
      insert into author_visits (group_id, starts_at, duration_min) values (g.id, p_starts, p_minutes) returning * into v;
    exception when unique_violation then return jsonb_build_object('error','slot_taken'); end;
  end if;
  return jsonb_build_object('visit_id', v.id, 'group_id', g.id, 'rescheduled', is_resched, 'previous_starts_at', prev,
                            'zoom_meeting_id', v.zoom_meeting_id, 'ics_sequence', v.ics_sequence);
end $$;

-- ---------- email outbox (all reminders are rows here; cron sends what is due) ----------
create table if not exists email_outbox (
  id          bigint generated always as identity primary key,
  dedupe_key  text unique not null,          -- e.g. 'act:<reg>:r48' → never sent twice
  to_email    citext not null,
  contact_id  uuid references contacts(id) on delete set null,
  template    text not null,
  data        jsonb not null default '{}'::jsonb,
  kind        text not null default 'transactional' check (kind in ('transactional','followup','marketing')),
  ref_type    text,                          -- 'activation_registration' | 'enrollment' | 'group' | 'visit' ...
  ref_id      uuid,
  send_at     timestamptz not null default now(),
  expires_at  timestamptz,                   -- e.g. a 1 h reminder is pointless after the session starts
  priority    int  not null default 5,           -- 1 = confirmations first, 7 = follow-ups last
  status      text not null default 'pending' check (status in ('pending','sending','sent','cancelled','skipped','failed')),
  attempts    int not null default 0,
  claimed_at  timestamptz,
  last_error  text,
  provider_id text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists email_outbox_due on email_outbox (send_at) where status = 'pending';
create index if not exists email_outbox_ref on email_outbox (ref_type, ref_id);

-- Claim due emails for sending. Does all "should this still go out?" checks in
-- one place, enriches rows with CURRENT links/times (so an admin edit to a Zoom
-- link or session time is reflected in later reminders), respects the daily
-- send budget (Resend free = 100/day), and uses SKIP LOCKED so the cron and an
-- immediate send never double-send the same row.
create or replace function claim_outbox(p_limit int default 15, p_ids bigint[] default null)
returns setof email_outbox language plpgsql as $$
declare budget int; daily int;
begin
  -- recover rows stuck in 'sending' (crashed invocation)
  update email_outbox set status = 'pending' where status = 'sending' and claimed_at < now() - interval '10 minutes';

  -- skip rows that should no longer be sent
  update email_outbox o set status = 'skipped', last_error = 'expired'
   where o.status = 'pending' and o.expires_at is not null and o.expires_at < now();
  update email_outbox o set status = 'skipped', last_error = 'unsubscribed'
    from contacts c where o.status = 'pending' and o.contact_id = c.id
     and ((o.kind in ('followup','marketing') and c.unsubscribed_at is not null)
       or (o.kind = 'marketing' and not c.marketing_opt_in));
  update email_outbox o set status = 'skipped', last_error = 'session_cancelled'
    from activation_registrations r join activation_sessions s on s.id = r.session_id
   where o.status = 'pending' and o.ref_type = 'activation_registration' and o.ref_id = r.id
     and o.template <> 'activation_cancelled' and s.status = 'cancelled';
  update email_outbox o set status = 'skipped', last_error = 'not_paid'
    from cohort_enrollments e
   where o.status = 'pending' and o.ref_type = 'enrollment' and o.ref_id = e.id and e.status <> 'paid';
  update email_outbox o set status = 'skipped', last_error = 'already_booked'
   where o.status = 'pending' and o.template = 'visit_unbooked_reminder'
     and exists (select 1 from author_visits v where v.group_id = o.ref_id and v.status in ('booked','completed'));
  update email_outbox o set status = 'skipped', last_error = 'visit_not_booked'
    from author_visits v
   where o.status = 'pending' and o.template = 'visit_reminder' and o.ref_id = v.id and v.status <> 'booked';

  select coalesce((value->>'daily_limit')::int, 95) into daily from settings where key = 'email';
  select coalesce(daily,95) - count(*) into budget from email_outbox
   where (status = 'sent' and sent_at >= date_trunc('day', now())) or status = 'sending';
  if budget <= 0 then return; end if;

  return query
  with picked as (
    select id from email_outbox
     where status = 'pending' and send_at <= now() and (p_ids is null or id = any(p_ids))
     order by priority, send_at
     limit least(p_limit, budget)
     for update skip locked
  )
  update email_outbox o set status = 'sending', claimed_at = now(), attempts = o.attempts + 1,
    data = o.data || coalesce((
      case
        when o.ref_type = 'activation_registration' then (
          select jsonb_build_object('starts_at', s.starts_at, 'duration_min', s.duration_min,
                 'zoom_url', coalesce(s.zoom_url, (select value->>'default_zoom_url' from settings where key='activation')),
                 'has_paid_cohort', exists(select 1 from cohort_enrollments e where e.contact_id = r.contact_id and e.status='paid'),
                 'has_group', exists(select 1 from groups g where g.leader_contact_id = r.contact_id)
                              or exists(select 1 from group_members m where m.contact_id = r.contact_id),
                 'cohort_open', exists(select 1 from cohorts c where c.status='open' and c.starts_at > now()))
            from activation_registrations r join activation_sessions s on s.id = r.session_id where r.id = o.ref_id)
        when o.ref_type = 'enrollment' then (
          select jsonb_build_object('cohort_name', c.name, 'cohort_starts_at', c.starts_at, 'zoom_url', c.zoom_url,
                 'workbook_url', c.workbook_url, 'instructions', c.instructions, 'schedule_text', c.schedule_text,
                 'cohort_tz', c.timezone)
            from cohort_enrollments e join cohorts c on c.id = e.cohort_id where e.id = o.ref_id)
        when o.ref_type = 'visit' then (
          select jsonb_build_object('starts_at', v.starts_at, 'duration_min', v.duration_min,
                 'zoom_url', coalesce(v.zoom_join_url, (select value->>'fallback_zoom_url' from settings where key='visit')))
            from author_visits v where v.id = o.ref_id)
      end), '{}'::jsonb)
  from picked where o.id = picked.id
  returning o.*;
end $$;

-- Record send results in one round trip: [{"id":1,"ok":true,"provider_id":"..."}, {"id":2,"ok":false,"error":"..."}]
create or replace function finish_outbox(p_results jsonb)
returns void language sql as $$
  update email_outbox o set
    status = case when (r->>'ok')::boolean then 'sent'
                  when o.attempts >= 4 then 'failed' else 'pending' end,
    sent_at = case when (r->>'ok')::boolean then now() end,
    provider_id = r->>'provider_id',
    last_error = r->>'error',
    -- back off failed sends: 5, 10, 15 min
    send_at = case when (r->>'ok')::boolean then o.send_at else now() + make_interval(mins => 5 * o.attempts) end
  from jsonb_array_elements(p_results) r
  where o.id = (r->>'id')::bigint
$$;

-- Admin-editable email copy (falls back to defaults in code when absent)
create table if not exists email_templates (
  key        text primary key,
  subject    text not null,
  body       text not null,       -- simple markdown-ish text with {{placeholders}}
  updated_at timestamptz not null default now()
);

-- ---------- analytics ----------
create table if not exists events (
  id         bigint generated always as identity primary key,
  type       text not null,       -- page_view, amazon_click, activation_signup, cohort_paid, group_created, member_joined, visit_booked...
  path       text,
  ref        text,                -- utm_source / referrer
  visitor_id text,                -- anonymous first-party id (no cookies sent to third parties)
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_type_time on events (type, created_at);

create or replace function admin_stats(p_days int default 30)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'since', now() - make_interval(days => p_days),
    'events', coalesce((select jsonb_object_agg(type, n) from (
        select type, count(*) n from events where created_at > now() - make_interval(days => p_days) group by type) t), '{}'::jsonb),
    'unique_visitors', (select count(distinct visitor_id) from events where type = 'page_view' and created_at > now() - make_interval(days => p_days)),
    'activation_signups', (select count(*) from activation_registrations where created_at > now() - make_interval(days => p_days)),
    'cohort_paid', (select count(*) from cohort_enrollments where status = 'paid' and paid_at > now() - make_interval(days => p_days)),
    'cohort_revenue_cents', (select coalesce(sum(amount_cents),0) from cohort_enrollments where status = 'paid' and paid_at > now() - make_interval(days => p_days)),
    'groups_created', (select count(*) from groups where created_at > now() - make_interval(days => p_days)),
    'members_joined', (select count(*) from group_members where created_at > now() - make_interval(days => p_days)),
    'groups_total', (select count(*) from groups),
    'groups_eligible', (select count(*) from groups where eligible_at is not null),
    'visits_booked', (select count(*) from author_visits where status = 'booked'),
    'visits_completed', (select count(*) from author_visits where status = 'completed'),
    'emails_sent_today', (select count(*) from email_outbox where status = 'sent' and sent_at >= date_trunc('day', now())),
    'emails_pending', (select count(*) from email_outbox where status = 'pending')
  )
$$;

-- Admin group overview
create or replace view group_overview as
  select g.id, g.name, g.invite_code, g.leader_token, g.member_count, g.eligible_at, g.created_at,
         g.start_date, g.end_date, g.meeting_day, g.meeting_time, g.frequency, g.timezone, g.est_size,
         c.email as leader_email, coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'') as leader_name,
         v.starts_at as visit_starts_at, v.status as visit_status,
         (select count(*) from group_members m where m.group_id = g.id and m.purchased) as purchased_yes
  from groups g join contacts c on c.id = g.leader_contact_id
  left join author_visits v on v.group_id = g.id;

-- ---------- lock everything down: server (service role) only ----------
do $$ declare t text; begin
  foreach t in array array['settings','books','contacts','activation_sessions','activation_registrations','cohorts',
    'cohort_enrollments','waitlist','groups','group_members','author_visits','visit_blackouts','email_outbox',
    'email_templates','events'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
revoke all on group_overview from anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['upsert_contact(text,text,text,boolean,text)',
    'register_activation(uuid,text,text,text,boolean)','reserve_cohort_seat(uuid,text,text,text,boolean)',
    'create_group(text,text,text,text,uuid,date,date,text,text,text,text,int,boolean)',
    'join_group(text,text,text,text,boolean,boolean)','book_visit(text,timestamptz,int)','admin_stats(int)',
    'claim_outbox(int,bigint[])','finish_outbox(jsonb)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------- seed defaults (placeholders until the questionnaire returns) ----------
insert into books (slug, volume, title, subtitle, promise, amazon, is_current) values
  ('volume-one', 1, '{{BOOK_TITLE}}', '{{BOOK_SUBTITLE}}', '{{ONE_LINE_PROMISE}}',
   '{"paperback":"{{AMAZON_PAPERBACK_URL}}","kindle":"{{AMAZON_KINDLE_URL}}"}', true)
on conflict (slug) do nothing;

insert into settings (key, value) values
  ('site', '{"author":"Imani Green","brand":"The Bloom Project","tagline":"{{TAGLINE}}",
             "sender_name":"Imani Green","reply_to":"{{REPLY_TO_EMAIL}}",
             "updates_list_name":"The Bloom Project updates","social":{"instagram":"","facebook":"","youtube":""},
             "testimonials":[]}'),
  ('activation', '{"enabled":true,"rule":{"weekdays":[3],"nth":[2,4],"time":"17:00"},"timezone":"America/Los_Angeles",
                   "duration_min":45,"default_zoom_url":"{{ACTIVATION_ZOOM_URL}}","capacity":null,"generate_months":3,
                   "next_steps_delay_min":60}'),
  ('cohort', '{"enabled":true,"waitlist_message":"Enrollment is closed right now. Join the waitlist and you will be first to know when the next cohort opens."}'),
  ('visit', '{"threshold":5,"duration_min":30,"timezone":"America/Los_Angeles",
              "weekly":{"1":[["10:00","16:00"]],"2":[["10:00","16:00"]],"3":[["10:00","15:00"]],"4":[["10:00","16:00"]]},
              "buffer_min":15,"min_notice_hours":48,"window_days":60,"max_per_week":3,
              "fallback_zoom_url":"{{AUTHOR_VISIT_ZOOM_URL}}","author_email":"{{IMANI_EMAIL}}"}'),
  ('email', '{"daily_limit":95,"from":"Imani Green <hello@{{DOMAIN}}>"}')
on conflict (key) do nothing;
