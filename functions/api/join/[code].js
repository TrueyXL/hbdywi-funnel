// GET  /api/join/:code → public group info for the invite page
// POST /api/join/:code {first_name, last_name, email, purchased: "yes"|"no", opt_in}
import { db, getSettings, eq } from '../../_lib/db.js';
import { json, fail, readBody, clean, isEmail, bool, isBot } from '../../_lib/util.js';
import { onGroupJoin, track } from '../../_lib/flows.js';

const okCode = (c) => /^[A-Z2-9]{6}$/.test((c || '').toUpperCase());

export async function onRequestGet({ params, env }) {
  if (!okCode(params.code)) return fail('Invite link not found', 404);
  const client = db(env);
  const g = await client.one('groups', `select=name,meeting_day,meeting_time,frequency,timezone,start_date,member_count,contacts!groups_leader_contact_id_fkey(first_name)&invite_code=${eq(params.code.toUpperCase())}`);
  if (!g) return fail('Invite link not found', 404);
  const settings = await getSettings(client);
  return json({ name: g.name, leader_first_name: g.contacts?.first_name, meeting_day: g.meeting_day, meeting_time: g.meeting_time,
                frequency: g.frequency, timezone: g.timezone, start_date: g.start_date, member_count: g.member_count,
                threshold: settings.visit.threshold, updates_list_name: settings.site.updates_list_name });
}

export async function onRequestPost(context) {
  const { params, request, env } = context;
  if (!okCode(params.code)) return fail('Invite link not found', 404);
  const b = await readBody(request);
  if (isBot(b)) return json({ ok: true });
  const first = clean(b.first_name, 80), last = clean(b.last_name, 80), email = clean(b.email, 254).toLowerCase();
  if (!first || !last || !isEmail(email)) return fail('Please enter your first name, last name and a valid email.');
  if (!['yes', 'no', true, false].includes(b.purchased)) return fail('Please tell us whether you have purchased Volume One.');
  const purchased = bool(b.purchased);
  const client = db(env);
  const res = await client.rpc('join_group', { p_code: params.code, p_email: email, p_first: first, p_last: last, p_purchased: purchased, p_opt_in: bool(b.opt_in) });
  if (res.error) return fail('Invite link not found', 404);
  await onGroupJoin(context, client, { res, member: { email, first_name: first, purchased }, settings: await getSettings(client) });
  if (!res.already_member) await track(client, 'member_joined', { group_id: res.group_id, purchased });
  return json({ ok: true, already_member: res.already_member, group_name: res.group_name, purchased,
                member_count: res.member_count, threshold: res.threshold, member_url: `/member?t=${res.member_token}` });
}
