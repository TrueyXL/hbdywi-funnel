# HBDYWI Reader Funnel

Year-round reader funnel for Imani Green's **HBDYWI, Volume One**: landing page with four pathways (free Activation, Amazon, $72 Guided Cohort, independent groups), the 5-member author-visit unlock, in-site booking, every automated email, an admin dashboard and first-party analytics.

- **Demo (GitHub Pages):** clickable preview with simulated data. No real emails, payments or bookings. `public/js/api.js` runs a fake backend in localStorage whenever the host is `*.github.io` (or `?demo=1`).
- **Production (Cloudflare Pages):** the same `public/` folder plus the real API in `functions/`.

Running cost to the client is about **$0/month** (see [Costs](#costs)).

---

## Architecture

```
Browser ── Cloudflare Pages (public/ static site)
   │        └── Pages Functions (functions/api/*)  ──► Supabase Postgres (service-role, RLS locked)
   │                     │                         ──► Resend (email)
   │                     │                         ──► Stripe Checkout + webhook
   │                     │                         ──► Zoom S2S API (optional)
   └── Stripe Checkout   │
cron-worker (every 5 min) ──► POST /api/cron/tick  → generate sessions, housekeeping, send due emails, keep Supabase awake
Imani's calendar ◄── /api/calendar/<token>.ics (subscribed feed) + .ics invites in emails
```

**Design decisions**

| Decision | Why |
|---|---|
| **Custom booking, not Cal.com** | The "one visit per group, reschedule allowed, unlocked only at 5" rules are enforced in the database (`author_visits.group_id UNIQUE`, `book_visit()` checks `eligible_at`). With Cal.com those rules would need webhooks and still allow outside bookings. |
| **Email outbox table** | Every message (immediate or scheduled) is one row with a unique `dedupe_key`, so nothing sends twice. The cron sends what is due. `claim_outbox()` re-checks at send time (cancelled session? refunded? already booked? unsubscribed?) and fills in the **current** Zoom link and time. |
| **Atomic SQL functions** | `join_group()` locks the group row, so concurrent joins are counted exactly and `eligible_at` is set by exactly one transaction, which means exactly one eligibility email. |
| **No npm dependencies** | Supabase, Stripe, Resend and Zoom are called with `fetch`. Nothing to build; deploy `public/` as is. |
| **Times stored in UTC, shown in the viewer's zone** | Activation rule "2nd and 4th Wed 5 PM Pacific" is DST-safe (`zonedToUtc`). The booking page lets the leader switch between their device's, their group's and Imani's time zones. |

### Folder structure

```
supabase/schema.sql        tables, unique constraints, RLS lock-down, atomic functions, seed settings
functions/
  _middleware.js           errors + security headers
  _lib/  db.js time.js templates.js outbox.js flows.js stripe.js zoom.js ics.js util.js
  api/config.js            GET public config (book, sessions, cohorts)
  api/activation/register.js
  api/cohort/checkout.js  waitlist.js  status.js
  api/stripe/webhook.js
  api/groups/create.js  [token].js         leader create / dashboard / update
  api/join/[code].js                       member signup via invite
  api/member/[token].js                    member updates purchase answer / consent
  api/visit/slots.js  book.js  cancel.js
  api/interest.js  track.js  unsubscribe.js
  api/calendar/[token].js                  ICS feed for Imani
  api/cron/tick.js
  api/admin/[[path]].js                    admin API
  go/amazon.js                             logs Amazon click → 302
  j/[code].js                              short invite link /j/ABC123
public/  index.html start-group.html group.html join.html member.html visit.html
         cohort-success.html unsubscribe.html privacy.html admin.html css/ js/
cron-worker/               5-minute scheduler
tests/logic.test.js        node --test
```

### Database (key constraints)

| Table | Duplicate / rule protection |
|---|---|
| `contacts` | `email citext UNIQUE`: one person, case-insensitive |
| `group_members` | `UNIQUE (group_id, contact_id)` **and** `UNIQUE (group_id, lower(email))`: repeat submissions update instead of adding |
| `groups` | `invite_code UNIQUE` (public), `leader_token UNIQUE` (private); `eligible_at` set once |
| `author_visits` | `group_id UNIQUE` (max one visit per group, ever); partial unique on `starts_at WHERE status='booked'` (Imani never double-booked) |
| `activation_registrations` | `UNIQUE (session_id, contact_id)` |
| `cohort_enrollments` | `UNIQUE (cohort_id, contact_id)`; seat held 35 min while paying |
| `email_outbox` | `dedupe_key UNIQUE` |

### Email sequences (section 3.8)

| Audience | Template keys | When |
|---|---|---|
| Activation registrant | `activation_confirm` (+ .ics), `activation_reminder` ×3, `activation_next_steps`, `activation_cancelled` | now; 48h/24h/1h before (elapsed ones skipped); 1h after the session ends |
| Cohort participant | `cohort_paid`, `cohort_welcome`, `cohort_materials`, `cohort_meeting_reminder` (24h/1h each meeting), `cohort_complete`, `cohort_waitlist_*` | on payment; 3 days before start; before each meeting; 1 day after the end |
| Group leader | `group_created`, `group_milestone`, `group_eligible`, `visit_unbooked_reminder` | now; 1st member and 1 away; at 5; +7d and +14d unless booked |
| Group member | `member_confirm` (Amazon link if "No") | now |
| Booked leader | `visit_confirm` / `visit_rescheduled` / `visit_cancelled` (+ .ics), `visit_reminder` | now; 48h and 1h before |
| Imani | `visit_author_notify` (+ .ics REQUEST/CANCEL) | on every booking change |

`activation_next_steps` leaves out the cohort pitch if the person has already paid, and the group pitch if they already lead or belong to a group. Follow-ups respect unsubscribe. Group membership never adds marketing consent; consent comes only from the separate, unticked opt-in box.

---

## Setup (about 1 hour)

1. **Supabase** (free): create project → SQL Editor → paste `supabase/schema.sql` → Run. Copy the Project URL and **service_role** key (Settings → API).
2. **Resend** (free): add and verify the client's domain (DNS records in Cloudflare), create an API key. Set `EMAIL_FROM` to an address on that domain.
3. **Stripe**: use the client's account. Copy the secret key. Add a webhook endpoint `https://DOMAIN/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`. Copy the signing secret. Turn on Settings → Emails → successful payments (Stripe's own receipt).
4. **Zoom** (optional, recommended): Zoom Marketplace → Develop → Server-to-Server OAuth app on Imani's account, scopes `meeting:write:admin` and `meeting:read:admin`. Copy Account ID, Client ID and Client Secret. Without it, set a fixed visit Zoom link in Admin.
5. **Cloudflare Pages**: `npx wrangler login` → `npx wrangler pages project create hbdywi-funnel` → set every secret from `.dev.vars.example` with `npx wrangler pages secret put NAME --project-name hbdywi-funnel` → set `SITE_URL` in `wrangler.toml` → `npm run deploy`. Attach the custom domain in the Pages dashboard.
6. **Cron**: `cd cron-worker`, set `SITE_URL` in its `wrangler.toml`, `npx wrangler deploy`, `npx wrangler secret put CRON_SECRET` (same value).
7. **Admin** (`/admin`): enter the book title and Amazon links, activation Zoom link, cohort(s), Imani's availability and notification email, sender and reply-to.
8. **Imani's calendar**: in Google Calendar → Other calendars → From URL → `https://DOMAIN/api/calendar/<CALENDAR_FEED_TOKEN>.ics`.

Local dev: `cp .dev.vars.example .dev.vars`, fill it in, `npm run dev` → http://localhost:8788. Tests: `npm test`. After editing `functions/_lib/time.js` run `npm run sync` (a test fails if the browser copy drifts).

---

## Test plan

Run on desktop Chrome/Safari **and** a phone (iOS Safari + Android Chrome). Use Stripe test mode (card `4242 4242 4242 4242`). Watch Admin → Exports & outbox.

**A. Success criterion (3.10)**
1. `/start-group`: register leader L with a group → invite link shown and emailed (`group_created`) with dashboard link.
2. Open the invite on a phone and register members M1–M4 (mix of Yes/No). Each gets `member_confirm`; the "No" ones include the Amazon link. L gets a milestone at 1 and at 4.
3. Dashboard shows 4/5 and locked. Register M5 → dashboard shows unlocked. L gets exactly **one** `group_eligible`.
4. Open booking link → only free times appear, labelled with time zone; switch zones and check the times shift correctly. Book → instant confirmation + .ics to L; Imani gets `visit_author_notify`; the calendar feed shows the visit; pending `visit_unbooked_reminder` rows become cancelled.

**B. Duplicates**
5. Re-submit M3 with the same email in different case (`M3@X.com`) → "already in, updated"; count stays 5. Change the answer Yes→No → reflected in Admin; count unchanged.
6. Two browsers submit the 5th member at the same moment → count 5, one eligibility email (row lock).

**C. Booking rules**
7. Reschedule → same visit row, `reschedule_count` +1, `visit_rescheduled` to L, Imani's invite updates (same UID, higher SEQUENCE), old reminders cancelled.
8. Second booking attempt: open the booking page in two tabs and book different times → the second one becomes a reschedule, never a second visit. API-level: `select count(*) from author_visits where group_id=…` = 1.
9. Two groups grab the same slot → the second gets "just taken" (partial unique index).
10. Cancel → `visit_cancelled`; the group can book again. Mark completed in Admin → the booking page says the visit is used and the API returns `visit_used`.
11. Group with 4 members: call `/api/visit/book` directly → 403 `not_eligible`.

**D. Activation**
12. Register 3+ days ahead → confirm now; 3 reminders pending.
13. **Late signup** 12h before → confirm + only the 1h reminder (48h/24h never created). 30 min before → session hidden (`starts_at > now`).
14. Admin cancels a date → registrants get `activation_cancelled`; reminders skipped. Admin moves a time → updated confirmation; old reminders cancelled.
15. After the session → `activation_next_steps`; for someone who already paid for a cohort, the cohort block is omitted.

**E. Cohort**
16. Pay with a test card → success page shows "enrolled"; `cohort_paid` + `cohort_welcome`; materials scheduled 3 days before start; reminders per meeting.
17. Replay the webhook from the Stripe dashboard → no duplicate emails (pending→paid transition only).
18. **Closed cohort**: set status Closed or fill seats → landing shows the waitlist form; checkout API returns 409. "Email waitlist" after opening a new cohort sends `cohort_waitlist_open` once per person.
19. Abandon checkout → seat released after 35 min (`expired`).
20. Refund in Stripe → enrollment `refunded`; remaining reminders skipped.

**F. Amazon & consent**
21. Click Buy → Amazon opens in a new tab **and** the invitation sheet slides in; nothing blocks Amazon. Admin shows the `amazon_click` event. Reload → "Welcome back" banner.
22. Register anywhere without ticking opt-in → `contacts.marketing_opt_in = false`. Unsubscribe link → follow-ups skipped; transactional booking emails still arrive.

**G. Limits & resilience**
23. Queue >95 emails in a day → the excess waits for tomorrow (cap in `settings.email.daily_limit`); expired reminders are skipped, not sent late.
24. Forms: keyboard-only, screen reader labels, 200% zoom, 320px width, no horizontal scroll.

---

## Costs

| Item | Cost | Flag |
|---|---|---|
| Cloudflare Pages + Functions + cron Worker | $0 (100k requests/day) | |
| Supabase free | $0 | Pauses after ~7 days idle; the 5-minute cron prevents that. 500 MB DB is plenty. |
| Resend free | $0 (100/day, 3,000/month) | **Upgrade to Pro ($20/mo) before a busy launch.** A 40-person activation is ~160 emails. The daily cap queues the overflow, but 1h reminders would be skipped. |
| Stripe | 2.9% + 30¢ (≈ $2.39 per $72 seat) | per sale only |
| Zoom | already paid | S2S app is free |
| Domain | ~$10.50/yr (.com at Cloudflare Registrar) | client pays |

## Assumptions (until the questionnaire returns)

- The leader does **not** count toward the 5 unless they also sign up through their own invite link (as a member).
- One complimentary visit per group, ever. Cancelling frees the slot and the group can rebook; a **completed** visit uses it up.
- Prices in USD; English only; activation host timezone and Imani's visit timezone are `America/Los_Angeles`.
- Visit availability placeholder: Mon–Thu 10:00–16:00 PT, 48h notice, 60-day window, max 3/week, 15-min buffer.
- All `{{PLACEHOLDER}}` values (title, Amazon URLs, Zoom links, domain, emails, bio, privacy text) are editable in Admin or listed in `supabase/schema.sql` seeds / `privacy.html` / `index.html` bio.

## Updating the GitHub demo

The demo is served from the `gh-pages` branch (the contents of `public/`):

```
npm test && git subtree push --prefix public origin gh-pages
```
