// GET /go/amazon?f=paperback&src=hero&vid=... → logs the click, then 302 to Amazon.
// An Amazon click is interest, not proof of purchase.
import { db, currentBook } from '../_lib/db.js';
import { clean } from '../_lib/util.js';

export async function onRequestGet({ request, env, waitUntil }) {
  const u = new URL(request.url);
  const f = clean(u.searchParams.get('f') || '', 20);
  let target = env.AMAZON_FALLBACK_URL || 'https://www.amazon.com/';
  try {
    const client = db(env);
    const book = await currentBook(client);
    const links = book?.amazon || {};
    target = links[f] || links.paperback || Object.values(links)[0] || target;
    waitUntil(client.insert('events', [{ type: 'amazon_click', path: '/go/amazon', visitor_id: clean(u.searchParams.get('vid') || '', 64),
      meta: { format: f || 'default', src: clean(u.searchParams.get('src') || '', 40), country: request.cf?.country } }]).catch(() => {}));
  } catch (e) { console.error('amazon', e.message); }
  if (!/^https:\/\//.test(target) || target.includes('{{')) target = 'https://www.amazon.com/s?k=' + encodeURIComponent('HBDYWI Imani Green');
  return Response.redirect(target, 302);
}
