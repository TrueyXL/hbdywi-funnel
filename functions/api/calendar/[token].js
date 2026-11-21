// GET /api/calendar/:CALENDAR_FEED_TOKEN.ics — private feed Imani subscribes to in Google/Outlook/Apple Calendar.
import { db, getSettings } from '../../_lib/db.js';
import { timingSafeEqual } from '../../_lib/util.js';
import { vevent, calendar } from '../../_lib/ics.js';

export async function onRequestGet({ params, env }) {
  const token = String(params.token || '').replace(/\.ics$/, '');
  if (!env.CALENDAR_FEED_TOKEN || !timingSafeEqual(token, env.CALENDAR_FEED_TOKEN)) return new Response('Not found', { status: 404 });
  const client = db(env);
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [settings, visits, sessions, cohorts] = await Promise.all([
    getSettings(client),
    client.select('author_visits', `select=*,groups(name,member_count,contacts!groups_leader_contact_id_fkey(first_name,last_name,email))&starts_at=gt.${since}`),
    client.select('activation_sessions', `select=*&status=eq.scheduled&starts_at=gt.${since}`),
    client.select('cohorts', `select=*&status=in.(open,closed)&ends_at=gt.${since}`),
  ]);
  const ev = [];
  for (const v of visits) {
    const l = v.groups?.contacts || {};
    ev.push(vevent({ uid: `visit-${v.group_id}@hbdywi`, start: v.starts_at, minutes: v.duration_min, sequence: v.ics_sequence,
      status: v.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED', title: `Author visit: ${v.groups?.name}`,
      description: `Leader: ${l.first_name || ''} ${l.last_name || ''} <${l.email || ''}>\nMembers: ${v.groups?.member_count}`,
      url: v.zoom_join_url || settings.visit.fallback_zoom_url }));
  }
  for (const s of sessions) ev.push(vevent({ uid: `act-${s.id}@hbdywi`, start: s.starts_at, minutes: s.duration_min, title: 'Free 45-Minute Activation',
    url: s.zoom_url || settings.activation.default_zoom_url }));
  for (const c of cohorts) (c.meeting_times || []).forEach((t, i) => ev.push(vevent({ uid: `cohort-${c.id}-${i}@hbdywi`, start: t,
    minutes: c.meeting_minutes, title: `${c.name}: meeting ${i + 1}`, url: c.zoom_url })));
  return new Response(calendar(ev, { name: 'HBDYWI sessions' }), { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' } });
}
