// GET /api/visit/slots?t=leader_token → eligibility, current booking and open slots (UTC ISO)
import { db, getSettings, eq } from '../../_lib/db.js';
import { json, fail } from '../../_lib/util.js';
import { visitSlots } from '../../_lib/time.js';
import { calendarBusy } from '../../_lib/gcal.js';

export async function onRequestGet({ request, env }) {
  const t = new URL(request.url).searchParams.get('t') || '';
  if (!/^[0-9a-f]{48}$/.test(t)) return fail('Not found', 404);
  const client = db(env);
  const g = await client.one('groups', `select=id,name,timezone,member_count,eligible_at&leader_token=${eq(t)}`);
  if (!g) return fail('Not found', 404);
  const settings = await getSettings(client);
  const now = new Date();
  const [visit, booked, blackouts] = await Promise.all([
    client.one('author_visits', `select=*&group_id=${eq(g.id)}`),
    client.select('author_visits', `select=starts_at,duration_min,group_id&status=eq.booked&starts_at=gt.${now.toISOString()}`),
    client.select('visit_blackouts', 'select=day'),
  ]);
  const others = booked.filter((b) => b.group_id !== g.id);
  const wantSlots = g.eligible_at && visit?.status !== 'completed';
  let busy = [], calendar_error = false;
  if (wantSlots) {
    try { busy = await calendarBusy(env, settings.visit, now, settings.visit.window_days ?? 60); }
    catch (e) { console.error('gcal', e.message); calendar_error = true; }
  }
  // If Google can't be reached, offer nothing rather than risk a clash with Imani's real calendar.
  const slots = wantSlots && !calendar_error ? visitSlots(settings.visit, others, blackouts.map((b) => b.day), now, busy) : [];
  return json({
    group: { name: g.name, timezone: g.timezone, member_count: g.member_count },
    threshold: settings.visit.threshold, eligible: !!g.eligible_at,
    author_timezone: settings.visit.timezone, duration_min: settings.visit.duration_min,
    min_notice_hours: settings.visit.min_notice_hours,
    visit: visit && { starts_at: visit.starts_at, status: visit.status, zoom_url: visit.status === 'booked' ? visit.zoom_join_url || settings.visit.fallback_zoom_url : null },
    slots, calendar_error,
  });
}
