// POST /api/interest {first_name, email, opt_in} — optional "send me the invitation" after an Amazon click.
import { db } from '../_lib/db.js';
import { json, fail, readBody, clean, isEmail, bool, isBot } from '../_lib/util.js';
import { queueAndSend } from '../_lib/outbox.js';
import { track } from '../_lib/flows.js';

export async function onRequestPost(context) {
  const b = await readBody(context.request);
  if (isBot(b)) return json({ ok: true });
  const first = clean(b.first_name, 80), email = clean(b.email, 254).toLowerCase();
  if (!first || !isEmail(email)) return fail('Please enter your first name and a valid email.');
  const client = db(context.env);
  const c = await client.rpc('upsert_contact', { p_email: email, p_first: first, p_last: '', p_opt_in: bool(b.opt_in), p_source: 'amazon_followup' });
  await client.update('contacts', `id=eq.${c.id}`, { amazon_clicked_at: new Date().toISOString() });
  // requested by the reader → transactional, but only ever once per person
  await queueAndSend(context, client, [{ key: `amz:${c.id}`, to: email, contact_id: c.id, template: 'amazon_followup', immediate: true,
    data: { first_name: first, unsub_token: c.unsub_token } }]);
  await track(client, 'amazon_followup_requested');
  return json({ ok: true });
}
