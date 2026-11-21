// Email outbox: every message (immediate or scheduled) is a row. Immediate
// messages are sent right away via waitUntil; scheduled ones go out on the cron
// tick. Dedupe keys make every send idempotent.

import { getSettings, currentBook } from './db.js';
import { render } from './templates.js';
import { formatWhen, hoursLabel } from './time.js';
import { icsAttachment } from './ics.js';
import { siteUrl } from './util.js';

const PRIORITY = { transactional: 1, reminder: 3, followup: 7, marketing: 8 };

/**
 * Queue emails. rows: [{key, to, contact_id, template, data, kind, ref_type, ref_id, send_at, expires_at, priority}]
 * Rows whose send_at already passed by more than `graceMin` are dropped (late signups skip elapsed reminders),
 * unless `immediate: true`.
 */
export async function queue(client, rows, { graceMin = 5 } = {}) {
  const now = Date.now();
  const keep = rows.filter((r) => r.immediate || !r.send_at || new Date(r.send_at).getTime() > now - graceMin * 60000);
  if (!keep.length) return [];
  const payload = keep.map((r) => ({
    dedupe_key: r.key,
    to_email: r.to,
    contact_id: r.contact_id || null,
    template: r.template,
    data: r.data || {},
    kind: r.kind || 'transactional',
    ref_type: r.ref_type || null,
    ref_id: r.ref_id || null,
    send_at: r.send_at ? new Date(r.send_at).toISOString() : new Date().toISOString(),
    expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    priority: r.priority ?? PRIORITY[r.kind || 'transactional'] ?? 5,
  }));
  return client.insert('email_outbox', payload, { ignoreDuplicates: true, onConflict: 'dedupe_key' });
}

export async function cancelPending(client, refType, refId, templates) {
  let q = `ref_type=eq.${refType}&ref_id=eq.${refId}&status=eq.pending`;
  if (templates?.length) q += `&template=in.(${templates.join(',')})`;
  return client.update('email_outbox', q, { status: 'cancelled', last_error: 'superseded' });
}

async function sendViaResend(env, msg) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(msg),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || `Resend ${r.status}`);
  return d.id;
}

/** Claim due rows and send them. Returns {sent, failed}. Keep `limit` small: Workers free = 50 subrequests. */
export async function processOutbox(env, client, { ids = null, limit = 15 } = {}) {
  const rows = await client.rpc('claim_outbox', { p_limit: limit, p_ids: ids });
  if (!rows?.length) return { sent: 0, failed: 0 };

  const [settings, book, overridesRows] = await Promise.all([
    getSettings(client),
    currentBook(client),
    client.select('email_templates', 'select=key,subject,body'),
  ]);
  const overrides = Object.fromEntries((overridesRows || []).map((t) => [t.key, t]));
  const base = siteUrl(env);
  const from = env.EMAIL_FROM || settings.email.from || `${settings.site.sender_name} <onboarding@resend.dev>`;
  const replyTo = settings.site.reply_to && !settings.site.reply_to.includes('{{') ? settings.site.reply_to : undefined;
  const hostTz = settings.activation.timezone || 'America/Los_Angeles';
  const amazon = book?.amazon?.paperback || book?.amazon?.kindle || Object.values(book?.amazon || {})[0] || base;

  const results = [];
  for (const row of rows) {
    try {
      const d = row.data || {};
      const tz = d.tz || hostTz;
      const vars = {
        author: settings.site.author, brand: settings.site.brand, updates_list_name: settings.site.updates_list_name,
        site_url: base, site_host: base.replace(/^https?:\/\//, ''), amazon_url: `${base}/go/amazon?src=email`,
        amazon_direct_url: amazon,
        activation_url: `${base}/#activation`, cohort_url: `${base}/#cohort`, group_start_url: `${base}/start-group`,
        book_title: book?.title,
        ...d,
      };
      if (d.starts_at) {
        vars.when = formatWhen(d.starts_at, tz);
        vars.when_short = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(new Date(d.starts_at));
        vars.when_host = formatWhen(d.starts_at, hostTz);
        vars.when_short_host = new Intl.DateTimeFormat('en-US', { timeZone: hostTz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d.starts_at));
      }
      if (d.previous_starts_at) {
        vars.previous_when = formatWhen(d.previous_starts_at, tz);
        vars.previous_when_host = formatWhen(d.previous_starts_at, hostTz);
      }
      if (d.cohort_starts_at) vars.cohort_when = formatWhen(d.cohort_starts_at, d.tz || d.cohort_tz || hostTz, { dateOnly: false });
      if (d.hours) vars.hours_label = hoursLabel(d.hours);
      const unsubscribeUrl = `${base}/unsubscribe?t=${d.unsub_token || ''}`;
      const msg = render(row.template, vars, overrides[row.template], { brand: settings.site.brand, unsubscribeUrl, kind: row.kind });

      const attachments = [];
      if (d.ics) {
        attachments.push(icsAttachment({
          uid: d.ics.uid, start: d.starts_at, minutes: d.duration_min || d.ics.minutes || 30,
          title: d.ics.title, description: `${d.ics.description || ''}\n${vars.zoom_url || ''}`.trim(),
          url: vars.zoom_url, sequence: d.ics.sequence || 0, status: d.ics.status || 'CONFIRMED',
        }, d.ics.method || 'PUBLISH'));
      }

      const id = await sendViaResend(env, {
        from, to: [row.to_email], subject: msg.subject, html: msg.html, text: msg.text,
        reply_to: replyTo, attachments: attachments.length ? attachments : undefined,
        headers: row.kind !== 'transactional' ? { 'List-Unsubscribe': `<${unsubscribeUrl}>` } : undefined,
      });
      results.push({ id: row.id, ok: true, provider_id: id });
    } catch (e) {
      results.push({ id: row.id, ok: false, error: String(e.message || e).slice(0, 500) });
    }
    if (rows.length > 1) await new Promise((r) => setTimeout(r, 520)); // Resend free: 2 req/s
  }
  await client.rpc('finish_outbox', { p_results: results });
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

/** Queue + send immediately in the background (does not delay the HTTP response). */
export async function queueAndSend(context, client, rows) {
  const inserted = await queue(client, rows);
  const nowIds = (inserted || []).filter((r) => new Date(r.send_at).getTime() <= Date.now() + 1000).map((r) => r.id);
  if (nowIds.length && context.env.RESEND_API_KEY) {
    context.waitUntil(processOutbox(context.env, client, { ids: nowIds, limit: nowIds.length }).catch((e) => console.error('send', e)));
  }
  return inserted;
}
