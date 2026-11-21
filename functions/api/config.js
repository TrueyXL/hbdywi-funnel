// GET /api/config — everything the public pages need, editable from Admin.
import { db, getSettings, currentBook } from '../_lib/db.js';
import { json } from '../_lib/util.js';

export async function onRequestGet({ env }) {
  const client = db(env);
  const now = new Date().toISOString();
  const [settings, book, sessions, cohorts] = await Promise.all([
    getSettings(client),
    currentBook(client),
    client.select('activation_sessions', `select=id,starts_at,duration_min,capacity,activation_registrations(count)&status=eq.scheduled&starts_at=gt.${now}&order=starts_at.asc&limit=6`),
    client.select('cohorts', `select=id,name,starts_at,ends_at,schedule_text,timezone,price_cents,currency,capacity,status,cohort_enrollments(count)&status=in.(open,closed)&starts_at=gt.${now}&order=starts_at.asc&limit=6`),
  ]);
  // count only paid + fresh pending toward capacity
  const holds = cohorts.length
    ? await client.select('cohort_enrollments', `select=cohort_id,status,created_at&cohort_id=in.(${cohorts.map((c) => c.id).join(',')})&status=in.(paid,pending)`)
    : [];
  const cutoff = Date.now() - 35 * 60000;
  const taken = {};
  for (const h of holds) if (h.status === 'paid' || new Date(h.created_at).getTime() > cutoff) taken[h.cohort_id] = (taken[h.cohort_id] || 0) + 1;

  return json({
    site: settings.site,
    book: book && { title: book.title, subtitle: book.subtitle, promise: book.promise, cover_url: book.cover_url, formats: Object.keys(book.amazon || {}) },
    activation: {
      enabled: settings.activation.enabled, duration_min: settings.activation.duration_min, timezone: settings.activation.timezone,
      sessions: sessions.map((s) => {
        const n = s.activation_registrations?.[0]?.count || 0;
        return { id: s.id, starts_at: s.starts_at, duration_min: s.duration_min, full: s.capacity != null && n >= s.capacity,
                 seats_left: s.capacity == null ? null : Math.max(0, s.capacity - n) };
      }),
    },
    cohort: {
      enabled: settings.cohort.enabled, waitlist_message: settings.cohort.waitlist_message,
      cohorts: cohorts.map((c) => {
        const left = Math.max(0, c.capacity - (taken[c.id] || 0));
        return { id: c.id, name: c.name, starts_at: c.starts_at, ends_at: c.ends_at, schedule_text: c.schedule_text, timezone: c.timezone,
                 price_cents: c.price_cents, currency: c.currency, seats_left: left, open: c.status === 'open' && left > 0 };
      }),
    },
    visit: { threshold: settings.visit.threshold },
  }, 200, { 'cache-control': 'public, max-age=30' });
}
