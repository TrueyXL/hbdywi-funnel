// POST /api/cohort/waitlist {first_name, last_name, email, opt_in}
import { db, currentBook } from '../../_lib/db.js';
import { json, fail, readBody, clean, isEmail, bool, isBot } from '../../_lib/util.js';
import { queueAndSend } from '../../_lib/outbox.js';
import { track } from '../../_lib/flows.js';

export async function onRequestPost(context) {
  const b = await readBody(context.request);
  if (isBot(b)) return json({ ok: true });
  const first = clean(b.first_name, 80), email = clean(b.email, 254).toLowerCase();
  if (!first || !isEmail(email)) return fail('Please enter your first name and a valid email.');
  const client = db(context.env);
  const contact = await client.rpc('upsert_contact', { p_email: email, p_first: first, p_last: clean(b.last_name, 80), p_opt_in: bool(b.opt_in), p_source: 'waitlist' });
  const book = await currentBook(client);
  await client.insert('waitlist', [{ contact_id: contact.id, book_id: book?.id || null }], { ignoreDuplicates: true, onConflict: 'contact_id,book_id' });
  await queueAndSend(context, client, [{ key: `wait:${contact.id}:${book?.id}`, to: email, contact_id: contact.id, template: 'cohort_waitlist_joined',
    immediate: true, data: { first_name: first, unsub_token: contact.unsub_token } }]);
  await track(client, 'waitlist_join');
  return json({ ok: true });
}
