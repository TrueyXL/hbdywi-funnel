// POST /api/activation/register {session_id, first_name, last_name, email, opt_in, tz}
import { db, getSettings, eq } from '../../_lib/db.js';
import { json, fail, readBody, clean, isEmail, bool, isUuid, isTz, isBot } from '../../_lib/util.js';
import { activationRows, track } from '../../_lib/flows.js';
import { queueAndSend } from '../../_lib/outbox.js';

export async function onRequestPost(context) {
  const b = await readBody(context.request);
  if (isBot(b)) return json({ ok: true });
  const first = clean(b.first_name, 80), last = clean(b.last_name, 80), email = clean(b.email, 254).toLowerCase();
  if (!first || !isEmail(email) || !isUuid(b.session_id)) return fail('Please enter your first name, a valid email and choose a date.');
  const client = db(context.env);
  const res = await client.rpc('register_activation', { p_session: b.session_id, p_email: email, p_first: first, p_last: last, p_opt_in: bool(b.opt_in) });
  if (res.error === 'session_full') return fail('That session just filled up. Please pick another date.', 409);
  if (res.error) return fail('That session is no longer available. Please pick another date.', 409);

  const [settings, session, contact] = await Promise.all([
    getSettings(client),
    client.one('activation_sessions', `select=*&id=${eq(b.session_id)}`),
    client.one('contacts', `select=*&id=${eq(res.contact_id)}`),
  ]);
  const tz = isTz(b.tz) ? b.tz : settings.activation.timezone;
  await queueAndSend(context, client, activationRows({ reg: res.registration_id, contact, session, tz, settings, unsub: res.unsub_token }));
  if (!res.already_registered) await track(client, 'activation_signup', { session_id: session.id });
  return json({ ok: true, already_registered: res.already_registered, starts_at: session.starts_at });
}
