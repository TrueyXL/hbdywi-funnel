// POST /api/visit/book {t, starts_at, tz} — book OR reschedule the group's single visit.
import { db, getSettings, eq } from '../../_lib/db.js';
import { json, fail, readBody, isTz } from '../../_lib/util.js';
import { visitSlots } from '../../_lib/time.js';
import { calendarBusy } from '../../_lib/gcal.js';
import { visitEmails, track } from '../../_lib/flows.js';
import { zoomEnabled, createMeeting, updateMeeting } from '../../_lib/zoom.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const b = await readBody(request);
  if (!/^[0-9a-f]{48}$/.test(b.t || '') || !b.starts_at) return fail('Please choose a time.');
  const client = db(env);
  const g = await client.one('groups', `select=*&leader_token=${eq(b.t)}`);
  if (!g) return fail('Not found', 404);
  if (!g.eligible_at) return fail(`Your group unlocks the visit once enough members have joined.`, 403);
  const settings = await getSettings(client);
  const now = new Date();

  // Re-validate the slot server-side (never trust the browser)
  const [booked, blackouts, existing] = await Promise.all([
    client.select('author_visits', `select=starts_at,duration_min,group_id&status=eq.booked&starts_at=gt.${now.toISOString()}`),
    client.select('visit_blackouts', 'select=day'),
    client.one('author_visits', `select=*&group_id=${eq(g.id)}`),
  ]);
  if (existing?.status === 'completed') return fail('Your group has already had its complimentary visit.', 409);
  const startIso = new Date(b.starts_at).toISOString();
  let busy;
  try { busy = await calendarBusy(env, settings.visit, now, settings.visit.window_days ?? 60); }
  catch (e) { console.error('gcal', e.message); return fail("We couldn't check the author's calendar just now. Please try again in a few minutes.", 503); }
  const open = visitSlots(settings.visit, booked.filter((x) => x.group_id !== g.id), blackouts.map((x) => x.day), now, busy);
  if (!open.includes(startIso)) return fail('Sorry, that time was just taken or is no longer available. Please pick another.', 409);
  if (existing?.status === 'booked' && existing.starts_at && new Date(existing.starts_at).toISOString() === startIso) return fail('That is already your booked time.', 409);

  const minutes = settings.visit.duration_min || 30;
  const res = await client.rpc('book_visit', { p_token: b.t, p_starts: startIso, p_minutes: minutes });
  if (res.error === 'slot_taken') return fail('Sorry, that time was just taken. Please pick another.', 409);
  if (res.error === 'visit_used') return fail('Your group has already had its complimentary visit.', 409);
  if (res.error) return fail('Unable to book. Please refresh and try again.', 409);

  // Zoom: create once, then move the same meeting on reschedule
  let patch = {};
  if (zoomEnabled(env)) {
    try {
      if (res.zoom_meeting_id) await updateMeeting(env, res.zoom_meeting_id, { startIso, minutes, tz: settings.visit.timezone });
      else {
        const m = await createMeeting(env, { topic: `Author visit: ${settings.site.author} × ${g.name}`, startIso, minutes, tz: settings.visit.timezone });
        patch = { zoom_meeting_id: String(m.id), zoom_join_url: m.join_url };
      }
    } catch (e) { console.error('zoom', e.message); }
  }
  if (!patch.zoom_join_url && !res.zoom_meeting_id) patch.zoom_join_url = settings.visit.fallback_zoom_url || null;
  const [visit] = Object.keys(patch).length
    ? await client.update('author_visits', `id=${eq(res.visit_id)}`, patch)
    : [await client.one('author_visits', `select=*&id=${eq(res.visit_id)}`)];
  const leader = await client.one('contacts', `select=*&id=${eq(g.leader_contact_id)}`);
  await visitEmails(context, client, {
    visit, group: g, leader, settings, tz: isTz(b.tz) ? b.tz : g.timezone,
    change: res.rescheduled ? 'rescheduled' : 'booked', previousStartsAt: res.rescheduled ? res.previous_starts_at : null,
  });
  await track(client, res.rescheduled ? 'visit_rescheduled' : 'visit_booked', { group_id: g.id });
  return json({ ok: true, rescheduled: res.rescheduled, starts_at: visit.starts_at, zoom_url: visit.zoom_join_url });
}
