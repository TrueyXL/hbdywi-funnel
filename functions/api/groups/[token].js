// GET  /api/groups/:leader_token  → leader dashboard data
// POST /api/groups/:leader_token  → update schedule/dates (same group, never a second one)
import { db, getSettings, eq } from '../../_lib/db.js';
import { json, fail, readBody, clean } from '../../_lib/util.js';
import { groupLinks } from '../../_lib/flows.js';
import { queueAndSend } from '../../_lib/outbox.js';
import { parseSchedule } from './create.js';

const okToken = (t) => /^[0-9a-f]{48}$/.test(t || '');

export async function onRequestGet({ params, env }) {
  if (!okToken(params.token)) return fail('Not found', 404);
  const client = db(env);
  const g = await client.one('groups', `select=*,contacts!groups_leader_contact_id_fkey(first_name,last_name,email),author_visits(starts_at,status,zoom_join_url,duration_min)&leader_token=${eq(params.token)}`);
  if (!g) return fail('Not found', 404);
  const [members, settings] = await Promise.all([
    client.select('group_members', `select=first_name,last_name,purchased,purchased_volume,created_at&group_id=${eq(g.id)}&order=created_at.asc`),
    getSettings(client),
  ]);
  const v = (Array.isArray(g.author_visits) ? g.author_visits[0] : g.author_visits) || null; // 1:1 embeds come back as an object
  return json({
    group: { name: g.name, start_date: g.start_date, end_date: g.end_date, meeting_day: g.meeting_day, meeting_time: g.meeting_time,
             frequency: g.frequency, timezone: g.timezone, est_size: g.est_size, goal: g.goal, created_at: g.created_at },
    leader: { first_name: g.contacts?.first_name },
    member_count: g.member_count, threshold: settings.visit.threshold, eligible: !!g.eligible_at, eligible_at: g.eligible_at,
    members: members.map((m) => ({ name: `${m.first_name} ${(m.last_name || '').slice(0, 1)}.`, purchased: m.purchased, purchased_volume: m.purchased_volume, joined: m.created_at })),
    visit: v && { starts_at: v.starts_at, status: v.status, duration_min: v.duration_min, zoom_url: v.status === 'booked' ? v.zoom_join_url : null },
    ...groupLinks(env, g),
  });
}

export async function onRequestPost(context) {
  const { params, request, env } = context;
  if (!okToken(params.token)) return fail('Not found', 404);
  const b = await readBody(request);
  if (b.resend) { // leader asks for their links again (e.g. to reschedule from another device)
    const client = db(env);
    const g = await client.one('groups', `select=*,contacts!groups_leader_contact_id_fkey(id,email,first_name)&leader_token=${eq(params.token)}`);
    if (!g) return fail('Not found', 404);
    const settings = await getSettings(client);
    const minute = Math.floor(Date.now() / 60000); // at most one resend per minute
    await queueAndSend(context, client, [{ key: `grp:${g.id}:links:${minute}`, to: g.contacts.email, contact_id: g.contacts.id, template: 'group_links', immediate: true,
      ref_type: 'group', ref_id: g.id, data: { first_name: g.contacts.first_name, group_name: g.name, threshold: settings.visit.threshold, eligible: !!g.eligible_at, ...groupLinks(env, g) } }]);
    return json({ ok: true, sent_to: g.contacts.email.replace(/^(.).*(@.*)$/, '$1•••$2') });
  }
  const s = parseSchedule(b);
  if (s.start && s.end && s.end < s.start) return fail('The end date must be after the start date.');
  const patch = { start_date: s.start, end_date: s.end, meeting_day: s.day, meeting_time: s.time, frequency: s.freq, est_size: s.est, updated_at: new Date().toISOString() };
  if (s.goal !== undefined) patch.goal = s.goal;
  if (s.tz) patch.timezone = s.tz;
  const name = clean(b.group_name, 120);
  if (name) patch.name = name;
  const rows = await db(env).update('groups', `leader_token=${eq(params.token)}`, patch);
  if (!rows?.length) return fail('Not found', 404);
  return json({ ok: true });
}
