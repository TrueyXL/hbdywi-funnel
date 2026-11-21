// POST /api/track {type, path, ref, vid, meta} — first-party analytics (sendBeacon).
import { db } from '../_lib/db.js';
import { json, readBody, clean } from '../_lib/util.js';

const ALLOWED = new Set(['page_view', 'cta_click', 'amazon_click', 'pathway_open', 'invite_copied', 'invite_shared']);

export async function onRequestPost({ request, env }) {
  const b = await readBody(request);
  if (!ALLOWED.has(b.type)) return json({ ok: false }, 400);
  if (/bot|crawl|spider|preview/i.test(request.headers.get('user-agent') || '')) return json({ ok: true });
  const meta = {};
  for (const [k, v] of Object.entries(b.meta || {}).slice(0, 10)) meta[clean(k, 40)] = typeof v === 'string' ? clean(v, 200) : v;
  meta.country = request.cf?.country;
  await db(env).insert('events', [{ type: b.type, path: clean(b.path, 300), ref: clean(b.ref, 300), visitor_id: clean(b.vid, 64), meta }]);
  return json({ ok: true });
}
