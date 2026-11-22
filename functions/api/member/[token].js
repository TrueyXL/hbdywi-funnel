// GET/POST /api/member/:member_token — member updates their purchase answer or consent.
import { db, eq, getSettings } from '../../_lib/db.js';
import { parseVolume } from '../join/[code].js';
import { json, fail, readBody, bool } from '../../_lib/util.js';
import { track } from '../../_lib/flows.js';

const ok = (t) => /^[0-9a-f]{48}$/.test(t || '');

export async function onRequestGet({ params, env }) {
  if (!ok(params.token)) return fail('Not found', 404);
  const client = db(env);
  const m = await client.one('group_members', `select=first_name,purchased,purchased_volume,groups(name),contacts(marketing_opt_in,unsubscribed_at)&member_token=${eq(params.token)}`);
  if (!m) return fail('Not found', 404);
  const settings = await getSettings(client);
  const vols = settings.site.volumes || ['Volume One'];
  return json({ first_name: m.first_name, purchased: m.purchased, purchased_volume: m.purchased_volume || (m.purchased ? vols[0] : 'none'), volumes: vols, group_name: m.groups?.name,
                opt_in: !!(m.contacts?.marketing_opt_in && !m.contacts?.unsubscribed_at) });
}

export async function onRequestPost({ params, request, env }) {
  if (!ok(params.token)) return fail('Not found', 404);
  const b = await readBody(request);
  const client = db(env);
  const m = await client.one('group_members', `select=id,contact_id,purchased&member_token=${eq(params.token)}`);
  if (!m) return fail('Not found', 404);
  if (b.purchased !== undefined || b.purchased_volume !== undefined) {
    const vol = parseVolume(b, await getSettings(client));
    if (!vol) return fail('Please choose a volume or "Not yet".');
    const purchased = vol !== 'none';
    await client.update('group_members', `id=${eq(m.id)}`, { purchased, purchased_volume: vol, updated_at: new Date().toISOString() });
    if (purchased !== m.purchased) await track(client, 'member_purchase_updated', { purchased });
  }
  if (b.opt_in !== undefined) {
    const yes = bool(b.opt_in);
    await client.update('contacts', `id=${eq(m.contact_id)}`, yes
      ? { marketing_opt_in: true, opt_in_at: new Date().toISOString(), opt_in_source: 'member_update', unsubscribed_at: null }
      : { marketing_opt_in: false });
  }
  return json({ ok: true });
}
