// POST /api/visit/cancel {t} — cancels the booking; the group keeps its one visit and can rebook.
import { db, getSettings, eq } from '../../_lib/db.js';
import { json, fail, readBody, isTz } from '../../_lib/util.js';
import { visitEmails, track } from '../../_lib/flows.js';
import { zoomEnabled, deleteMeeting } from '../../_lib/zoom.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const b = await readBody(request);
  if (!/^[0-9a-f]{48}$/.test(b.t || '')) return fail('Not found', 404);
  const client = db(env);
  const g = await client.one('groups', `select=*&leader_token=${eq(b.t)}`);
  if (!g) return fail('Not found', 404);
  const v = await client.one('author_visits', `select=*&group_id=${eq(g.id)}&status=eq.booked`);
  if (!v) return fail('There is no booked visit to cancel.', 409);
  const [visit] = await client.update('author_visits', `id=${eq(v.id)}`, {
    status: 'cancelled', zoom_meeting_id: null, ics_sequence: v.ics_sequence + 1, updated_at: new Date().toISOString(),
  });
  if (zoomEnabled(env) && v.zoom_meeting_id) { try { await deleteMeeting(env, v.zoom_meeting_id); } catch (e) { console.error('zoom', e.message); } }
  const [settings, leader] = await Promise.all([getSettings(client), client.one('contacts', `select=*&id=${eq(g.leader_contact_id)}`)]);
  await visitEmails(context, client, { visit: { ...visit, zoom_join_url: v.zoom_join_url }, group: g, leader, settings,
    tz: isTz(b.tz) ? b.tz : g.timezone, change: 'cancelled', previousStartsAt: v.starts_at });
  await track(client, 'visit_cancelled', { group_id: g.id });
  return json({ ok: true });
}
