// POST /api/unsubscribe {t} — stops follow-up/marketing email. Transactional (your own bookings) still arrive.
import { db, eq } from '../_lib/db.js';
import { json, fail, readBody } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  const b = await readBody(request);
  if (!/^[0-9a-f]{48}$/.test(b.t || '')) return fail('Invalid link', 400);
  const rows = await db(env).update('contacts', `unsub_token=${eq(b.t)}`, { unsubscribed_at: new Date().toISOString(), marketing_opt_in: false });
  if (!rows?.length) return fail('Invalid link', 404);
  return json({ ok: true });
}
