// POST /api/groups/create — leader registration
import { db, getSettings, currentBook } from '../../_lib/db.js';
import { json, fail, readBody, clean, isEmail, bool, isTz, isBot } from '../../_lib/util.js';
import { queueAndSend } from '../../_lib/outbox.js';
import { groupLinks, track } from '../../_lib/flows.js';

export const parseSchedule = (b) => ({
  start: /^\d{4}-\d{2}-\d{2}$/.test(b.start_date || '') ? b.start_date : null,
  end: /^\d{4}-\d{2}-\d{2}$/.test(b.end_date || '') ? b.end_date : null,
  day: clean(b.meeting_day, 20) || null,
  time: /^\d{2}:\d{2}$/.test(b.meeting_time || '') ? b.meeting_time : null,
  freq: clean(b.frequency, 40) || null,
  tz: isTz(b.timezone) ? b.timezone : null,
  goal: typeof b.goal === 'string' ? b.goal.trim().slice(0, 1000) || null : undefined,
  est: Number.isFinite(+b.est_size) && +b.est_size > 0 ? Math.min(10000, Math.round(+b.est_size)) : null,
});

export async function onRequestPost(context) {
  const b = await readBody(context.request);
  if (isBot(b)) return json({ ok: true });
  const first = clean(b.first_name, 80), last = clean(b.last_name, 80), email = clean(b.email, 254).toLowerCase(), name = clean(b.group_name, 120);
  if (!first || !isEmail(email) || !name) return fail('Please enter your name, a valid email and a group name.');
  const s = parseSchedule(b);
  if (s.start && s.end && s.end < s.start) return fail('The end date must be after the start date.');
  const client = db(context.env);
  const [settings, book] = await Promise.all([getSettings(client), currentBook(client)]);
  const res = await client.rpc('create_group', {
    p_email: email, p_first: first, p_last: last, p_name: name, p_book: book?.id || null,
    p_start: s.start, p_end: s.end, p_day: s.day, p_time: s.time, p_freq: s.freq, p_tz: s.tz, p_est: s.est, p_opt_in: bool(b.opt_in),
  });
  if (s.goal) await client.update('groups', `id=eq.${res.group_id}`, { goal: s.goal });
  const links = groupLinks(context.env, res);
  await queueAndSend(context, client, [{
    key: `grp:${res.group_id}:created`, to: email, contact_id: res.contact_id, template: 'group_created', immediate: true,
    ref_type: 'group', ref_id: res.group_id,
    data: { first_name: first, group_name: name, threshold: settings.visit.threshold, ...links },
  }]);
  await track(client, 'group_created', { group_id: res.group_id });
  return json({ ok: true, ...links, invite_code: res.invite_code });
}
