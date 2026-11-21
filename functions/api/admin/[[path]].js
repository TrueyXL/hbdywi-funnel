// /api/admin/* — single router for the admin dashboard. Header: x-admin-key: ADMIN_PASSWORD
import { db, getSettings, eq, DEFAULT_SETTINGS } from '../../_lib/db.js';
import { json, fail, readBody, timingSafeEqual, isEmail, siteUrl } from '../../_lib/util.js';
import { TEMPLATES } from '../../_lib/templates.js';
import { queue, queueAndSend, processOutbox, cancelPending } from '../../_lib/outbox.js';
import { activationRows, resyncCohort, groupLinks } from '../../_lib/flows.js';

const csv = (rows) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
};

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!env.ADMIN_PASSWORD || !timingSafeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_PASSWORD)) return fail('unauthorized', 401);
  const client = db(env);
  const [a, b, c] = params.path || [];
  const m = request.method;
  const body = m === 'GET' ? {} : await readBody(request);
  const url = new URL(request.url);
  const now = new Date().toISOString();

  // ---- dashboard ----
  if (a === 'stats') return json(await client.rpc('admin_stats', { p_days: Number(url.searchParams.get('days') || 30) }));

  // ---- settings & books ----
  if (a === 'settings' && m === 'GET') return json({ settings: await getSettings(client), books: await client.select('books', 'select=*&order=volume.asc'), defaults: DEFAULT_SETTINGS });
  if (a === 'settings' && m === 'PUT' && b) {
    if (!(b in DEFAULT_SETTINGS)) return fail('unknown settings key');
    await client.insert('settings', [{ key: b, value: body.value, updated_at: now }], { upsert: true, onConflict: 'key' });
    return json({ ok: true });
  }
  if (a === 'books' && m === 'POST') {
    const { id, ...rest } = body;
    if (rest.is_current) await client.update('books', 'is_current=is.true', { is_current: false });
    const row = id ? (await client.update('books', `id=${eq(id)}`, rest))[0] : (await client.insert('books', [rest]))[0];
    return json(row);
  }

  // ---- activation sessions ----
  if (a === 'sessions' && m === 'GET' && !b) return json(await client.select('activation_sessions', `select=*,activation_registrations(count)&starts_at=gt.${new Date(Date.now() - 60 * 86400000).toISOString()}&order=starts_at.asc`));
  if (a === 'sessions' && m === 'GET' && c === 'registrants') return json(await client.select('activation_registrations', `select=created_at,attended,contacts(first_name,last_name,email,marketing_opt_in)&session_id=${eq(b)}&order=created_at.asc`));
  if (a === 'sessions' && m === 'POST') return json((await client.insert('activation_sessions', [{ starts_at: body.starts_at, duration_min: body.duration_min || 45, zoom_url: body.zoom_url || null, capacity: body.capacity || null }]))[0]);
  if (a === 'sessions' && m === 'PATCH' && b) {
    const before = await client.one('activation_sessions', `select=*&id=${eq(b)}`);
    const patch = {};
    for (const k of ['starts_at', 'zoom_url', 'capacity', 'status', 'duration_min']) if (k in body) patch[k] = body[k] === '' ? null : body[k];
    const [s] = await client.update('activation_sessions', `id=${eq(b)}`, patch);
    const regs = await client.select('activation_registrations', `select=id,contacts(*)&session_id=${eq(b)}`);
    const settings = await getSettings(client);
    if (patch.status === 'cancelled' && before.status !== 'cancelled') {
      await queueAndSend(context, client, regs.map((r) => ({ key: `act:${r.id}:cancelled`, to: r.contacts.email, contact_id: r.contacts.id,
        template: 'activation_cancelled', immediate: true, ref_type: 'activation_registration', ref_id: r.id,
        data: { first_name: r.contacts.first_name, starts_at: before.starts_at, tz: settings.activation.timezone, unsub_token: r.contacts.unsub_token } })));
      for (const r of regs) await cancelPending(client, 'activation_registration', r.id, ['activation_reminder', 'activation_next_steps']);
    } else if (patch.starts_at && new Date(patch.starts_at).getTime() !== new Date(before.starts_at).getTime()) {
      for (const r of regs) {
        await cancelPending(client, 'activation_registration', r.id, ['activation_reminder']);
        await queueAndSend(context, client, activationRows({ reg: r.id, contact: r.contacts, session: s, tz: settings.activation.timezone, settings, unsub: r.contacts.unsub_token }));
      }
    }
    return json({ ...s, notified: regs.length });
  }

  // ---- cohorts ----
  if (a === 'cohorts' && m === 'GET' && !b) return json(await client.select('cohorts', 'select=*,cohort_enrollments(status)&order=starts_at.desc'));
  if (a === 'cohorts' && m === 'GET' && c === 'enrollments') return json(await client.select('cohort_enrollments', `select=status,amount_cents,paid_at,created_at,contacts(first_name,last_name,email)&cohort_id=${eq(b)}&order=created_at.asc`));
  if (a === 'cohorts' && m === 'POST' && !b) {
    const row = (await client.insert('cohorts', [body]))[0];
    return json(row);
  }
  if (a === 'cohorts' && m === 'PATCH' && b) {
    const [row] = await client.update('cohorts', `id=${eq(b)}`, body);
    if (['starts_at', 'ends_at', 'meeting_times'].some((k) => k in body)) await resyncCohort(env, client, b, await getSettings(client));
    return json(row);
  }
  if (a === 'cohorts' && m === 'POST' && c === 'notify-waitlist') {
    const co = await client.one('cohorts', `select=*&id=${eq(b)}`);
    const list = await client.select('waitlist', 'select=id,contacts(*)&notified_at=is.null');
    await queue(client, list.map((w) => ({ key: `wait:${w.id}:open:${co.id}`, to: w.contacts.email, contact_id: w.contacts.id, template: 'cohort_waitlist_open',
      kind: 'transactional', priority: 4, data: { first_name: w.contacts.first_name, cohort_name: co.name, cohort_starts_at: co.starts_at, cohort_tz: co.timezone, unsub_token: w.contacts.unsub_token } })));
    if (list.length) await client.update('waitlist', `id=in.(${list.map((w) => w.id).join(',')})`, { notified_at: now });
    return json({ queued: list.length });
  }

  // ---- groups ----
  if (a === 'groups' && m === 'GET' && !b) return json(await client.select('group_overview', 'select=*&order=created_at.desc'));
  if (a === 'groups' && m === 'GET' && b) {
    const g = await client.one('group_overview', `select=*&id=${eq(b)}`);
    const members = await client.select('group_members', `select=first_name,last_name,email,purchased,created_at,updated_at&group_id=${eq(b)}&order=created_at.asc`);
    return json({ ...g, members, ...groupLinks(env, g) });
  }
  if (a === 'groups' && m === 'PATCH' && b) {
    const allowed = ['name', 'start_date', 'end_date', 'meeting_day', 'meeting_time', 'frequency', 'timezone', 'est_size'];
    const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    return json((await client.update('groups', `id=${eq(b)}`, { ...patch, updated_at: now }))[0]);
  }
  if (a === 'groups' && m === 'POST' && c === 'resend-invite') {
    const g = await client.one('groups', `select=*,contacts!groups_leader_contact_id_fkey(*)&id=${eq(b)}`);
    const settings = await getSettings(client);
    const tpl = g.eligible_at ? 'group_eligible' : 'group_created';
    await queueAndSend(context, client, [{ key: `grp:${g.id}:resend:${Date.now()}`, to: g.contacts.email, contact_id: g.contacts.id, template: tpl, immediate: true,
      ref_type: 'group', ref_id: g.id, data: { first_name: g.contacts.first_name, group_name: g.name, threshold: settings.visit.threshold, ...groupLinks(env, g) } }]);
    return json({ ok: true, template: tpl });
  }

  // ---- visits & availability ----
  if (a === 'visits' && m === 'GET') return json(await client.select('author_visits', 'select=*,groups(name,member_count,leader_token)&order=starts_at.desc'));
  if (a === 'visits' && m === 'PATCH' && b) {
    if (!['completed', 'booked'].includes(body.status)) return fail('Use the leader booking page to cancel/reschedule so emails go out, or set completed.');
    return json((await client.update('author_visits', `id=${eq(b)}`, { status: body.status, updated_at: now }))[0]);
  }
  if (a === 'blackouts' && m === 'GET') return json(await client.select('visit_blackouts', 'select=*&order=day.asc'));
  if (a === 'blackouts' && m === 'POST') return json((await client.insert('visit_blackouts', [{ day: body.day, note: body.note || null }], { ignoreDuplicates: true, onConflict: 'day' }))[0] || {});
  if (a === 'blackouts' && m === 'DELETE' && b) { await client.remove('visit_blackouts', `id=${eq(b)}`); return json({ ok: true }); }

  // ---- email templates ----
  if (a === 'templates' && m === 'GET') {
    const over = Object.fromEntries((await client.select('email_templates', 'select=*')).map((t) => [t.key, t]));
    return json(Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, subject: over[key]?.subject ?? t.subject, body: over[key]?.body ?? t.body,
      customized: !!over[key], default_subject: t.subject, default_body: t.body })));
  }
  if (a === 'templates' && m === 'PUT' && b) {
    if (!TEMPLATES[b]) return fail('unknown template');
    await client.insert('email_templates', [{ key: b, subject: body.subject, body: body.body, updated_at: now }], { upsert: true, onConflict: 'key' });
    return json({ ok: true });
  }
  if (a === 'templates' && m === 'DELETE' && b) { await client.remove('email_templates', `key=${eq(b)}`); return json({ ok: true }); }
  if (a === 'test-email' && m === 'POST') {
    if (!isEmail(body.to) || !TEMPLATES[body.template]) return fail('to + template required');
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();
    const base = siteUrl(env);
    const sample = { first_name: 'Test', group_name: 'Sample Book Club', member_count: 5, threshold: 5, remaining: 1, new_member_name: 'Ada',
      starts_at: soon, previous_starts_at: soon, cohort_name: 'Sample Cohort', cohort_starts_at: soon, amount: '$72.00', hours: 24,
      zoom_url: 'https://zoom.us/j/000', invite_url: `${base}/j/SAMPLE`, dashboard_url: `${base}/group?t=sample`, booking_url: `${base}/visit?t=sample`,
      member_url: `${base}/member?t=sample`, leader_name: 'Jordan', leader_email: 'leader@example.com', change: 'booked', schedule_text: 'Tuesdays 6 PM PT',
      workbook_url: `${base}/`, cohort_open: true };
    const [row] = await queue(client, [{ key: `test:${Date.now()}`, to: body.to, template: body.template, data: sample, immediate: true, priority: 0 }]);
    return json(await processOutbox(env, client, { ids: [row.id], limit: 1 }));
  }

  // ---- outbox ----
  if (a === 'outbox' && m === 'GET') {
    const st = url.searchParams.get('status');
    return json(await client.select('email_outbox', `select=id,to_email,template,kind,status,send_at,sent_at,attempts,last_error${st ? '&status=' + eq(st) : ''}&order=send_at.desc&limit=200`));
  }
  if (a === 'outbox' && m === 'POST' && c === 'retry') return json((await client.update('email_outbox', `id=${eq(b)}`, { status: 'pending', send_at: now, attempts: 0 }))[0]);
  if (a === 'outbox' && m === 'POST' && b === 'run') return json(await processOutbox(env, client, { limit: 15 }));

  // ---- exports ----
  if (a === 'export' && m === 'GET') {
    const q = {
      contacts: ['contacts', 'select=email,first_name,last_name,marketing_opt_in,opt_in_at,opt_in_source,unsubscribed_at,created_at&order=created_at.asc'],
      members: ['group_members', 'select=email,first_name,last_name,purchased,created_at,groups(name,invite_code)&order=created_at.asc'],
      enrollments: ['cohort_enrollments', 'select=status,amount_cents,paid_at,created_at,cohorts(name),contacts(email,first_name,last_name)&order=created_at.asc'],
      activation: ['activation_registrations', 'select=created_at,activation_sessions(starts_at),contacts(email,first_name,last_name)&order=created_at.asc'],
      optins: ['contacts', 'select=email,first_name,last_name,opt_in_at,opt_in_source&marketing_opt_in=is.true&unsubscribed_at=is.null'],
    }[String(b || '').replace('.csv', '')];
    if (!q) return fail('unknown export');
    const rows = await client.select(...q);
    const flat = rows.map((r) => Object.fromEntries(Object.entries(r).flatMap(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([k2, v2]) => [`${k}_${k2}`, v2 && typeof v2 === 'object' ? JSON.stringify(v2) : v2]) : [[k, v]])));
    return new Response(csv(flat), { headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="${b}"` } });
  }

  return fail('not found', 404);
}
