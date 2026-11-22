// Business flows shared by routes, the Stripe webhook, admin and cron.

import { eq } from './db.js';
import { queue, queueAndSend, cancelPending } from './outbox.js';
import { reminderTimes } from './time.js';
import { siteUrl } from './util.js';

export const groupLinks = (env, g) => ({
  invite_url: `${siteUrl(env)}/j/${g.invite_code}`,
  dashboard_url: `${siteUrl(env)}/group?t=${g.leader_token}`,
  booking_url: `${siteUrl(env)}/visit?t=${g.leader_token}`,
});

export async function track(client, type, meta = {}, extra = {}) {
  try { await client.insert('events', [{ type, meta, ...extra }]); } catch (e) { console.error('track', e.message); }
}

// ---------- activation ----------
export function activationRows({ reg, contact, session, tz, settings, unsub }) {
  const base = { to: contact.email, contact_id: contact.id, ref_type: 'activation_registration', ref_id: reg };
  const data = { first_name: contact.first_name, tz, unsub_token: unsub };
  const end = new Date(new Date(session.starts_at).getTime() + (session.duration_min || 45) * 60000);
  const rows = [{
    ...base, key: `act:${reg}:confirm:${session.starts_at}`, template: 'activation_confirm', immediate: true,
    data: { ...data, ics: { uid: `act-${session.id}@hbdywi`, title: 'Free 45-Minute Activation', description: `With ${settings.site.author}` } },
  }];
  for (const r of reminderTimes(session.starts_at, [48, 24, 1])) {
    rows.push({ ...base, key: `act:${reg}:r${r.hours}:${session.starts_at}`, template: 'activation_reminder', kind: 'transactional',
      priority: 3, send_at: r.at, expires_at: session.starts_at, data: { ...data, hours: r.hours } });
  }
  rows.push({ ...base, key: `act:${reg}:next`, template: 'activation_next_steps', kind: 'followup',
    send_at: new Date(end.getTime() + (settings.activation.next_steps_delay_min ?? 60) * 60000), data });
  return rows;
}

// ---------- cohort ----------
export function cohortRows({ enrollment, contact, cohort, settings, tz }) {
  const base = { to: contact.email, contact_id: contact.id, ref_type: 'enrollment', ref_id: enrollment.id };
  const data = { first_name: contact.first_name, tz: tz || cohort.timezone, unsub_token: contact.unsub_token };
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: (cohort.currency || 'usd').toUpperCase() }).format((enrollment.amount_cents ?? cohort.price_cents) / 100);
  const startMs = new Date(cohort.starts_at).getTime();
  const rows = [
    { ...base, key: `enr:${enrollment.id}:paid`, template: 'cohort_paid', immediate: true, data: { ...data, amount } },
    { ...base, key: `enr:${enrollment.id}:welcome`, template: 'cohort_welcome', immediate: true, priority: 2, data },
    { ...base, key: `enr:${enrollment.id}:materials:${cohort.starts_at}`, template: 'cohort_materials', immediate: true, priority: 2,
      send_at: new Date(Math.max(Date.now(), startMs - 3 * 86400000)), data },
  ];
  for (const t of cohort.meeting_times || []) {
    for (const r of reminderTimes(t, [24, 1])) {
      rows.push({ ...base, key: `enr:${enrollment.id}:m:${t}:r${r.hours}`, template: 'cohort_meeting_reminder', priority: 3,
        send_at: r.at, expires_at: t, data: { ...data, starts_at: t, duration_min: cohort.meeting_minutes, hours: r.hours } });
    }
  }
  rows.push({ ...base, key: `enr:${enrollment.id}:complete`, template: 'cohort_complete', kind: 'followup',
    send_at: new Date(new Date(cohort.ends_at).getTime() + 86400000), data });
  return rows;
}

/** Re-sync reminders after an admin edits a cohort's dates/meetings. */
export async function resyncCohort(env, client, cohortId, settings) {
  const cohort = await client.one('cohorts', `select=*&id=${eq(cohortId)}`);
  const enrollments = await client.select('cohort_enrollments', `select=*,contacts(*)&cohort_id=${eq(cohortId)}&status=eq.paid`);
  for (const e of enrollments) {
    await client.update('email_outbox', `ref_type=eq.enrollment&ref_id=${eq(e.id)}&status=eq.pending&template=in.(cohort_meeting_reminder,cohort_materials,cohort_complete)`, { status: 'cancelled', last_error: 'resync' });
    const rows = cohortRows({ enrollment: e, contact: e.contacts, cohort, settings })
      .filter((r) => !['cohort_paid', 'cohort_welcome'].includes(r.template))
      .map((r) => ({ ...r, key: r.key + ':v' + Date.now(), immediate: r.template === 'cohort_materials' ? true : r.immediate }));
    // don't resend materials if already sent once
    const sent = await client.one('email_outbox', `select=id&ref_type=eq.enrollment&ref_id=${eq(e.id)}&template=eq.cohort_materials&status=eq.sent`);
    await queue(client, sent ? rows.filter((r) => r.template !== 'cohort_materials') : rows);
  }
}

/** Called by the Stripe webhook. Idempotent: emails go out only on the pending→paid transition. */
export async function markPaid(context, client, { enrollmentId, sessionId, paymentIntent, amount, settings }) {
  const updated = await client.update('cohort_enrollments', `id=${eq(enrollmentId)}&status=neq.paid`, {
    status: 'paid', stripe_session_id: sessionId, stripe_payment_intent: paymentIntent, amount_cents: amount,
    paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  if (!updated?.length) return { already: true };
  const e = updated[0];
  const [contact, cohort] = await Promise.all([
    client.one('contacts', `select=*&id=${eq(e.contact_id)}`),
    client.one('cohorts', `select=*&id=${eq(e.cohort_id)}`),
  ]);
  await queueAndSend(context, client, cohortRows({ enrollment: e, contact, cohort, settings }));
  await track(client, 'cohort_paid', { cohort_id: cohort.id, amount });
  // auto-close when full
  const paid = await client.select('cohort_enrollments', `select=id&cohort_id=${eq(cohort.id)}&status=eq.paid`);
  if (paid.length >= cohort.capacity) await client.update('cohorts', `id=${eq(cohort.id)}`, { status: 'closed' });
  return { ok: true };
}

// ---------- groups ----------
export async function onGroupJoin(context, client, { res, member, settings }) {
  const env = context.env;
  const [g, leader] = await Promise.all([
    client.one('groups', `select=*&id=${eq(res.group_id)}`),
    client.one('contacts', `select=*&id=${eq(res.leader_contact_id)}`),
  ]);
  const links = groupLinks(env, g);
  const rows = [{
    key: `mem:${res.member_id}:confirm:${member.purchased}:${res.already_member ? Date.now() : 0}`,
    to: member.email, contact_id: null, template: 'member_confirm', immediate: true,
    ref_type: 'group', ref_id: g.id,
    data: { first_name: member.first_name, group_name: g.name, leader_name: leader.first_name, purchased: member.purchased,
            member_url: `${siteUrl(env)}/member?t=${res.member_token}`, unsub_token: res.unsub_token },
  }];
  if (!res.already_member) {
    const remaining = Math.max(0, res.threshold - res.member_count);
    // milestone: first member, and when exactly 1 away (eligibility mail covers the threshold itself)
    if (res.member_count === 1 || remaining === 1 || (remaining > 1 && res.member_count % 5 === 0)) {
      rows.push({ key: `grp:${g.id}:milestone:${res.member_count}`, to: leader.email, contact_id: leader.id, template: 'group_milestone',
        immediate: true, ref_type: 'group', ref_id: g.id,
        data: { first_name: leader.first_name, group_name: g.name, member_count: res.member_count, threshold: res.threshold,
                remaining, new_member_name: member.first_name, ...links } });
    }
  }
  if (res.just_unlocked) {
    const d = { first_name: leader.first_name, group_name: g.name, ...links, unsub_token: leader.unsub_token };
    rows.push(
      { key: `grp:${g.id}:eligible`, to: leader.email, contact_id: leader.id, template: 'group_eligible', immediate: true, ref_type: 'group', ref_id: g.id, data: d },
      { key: `grp:${g.id}:unbooked7`, to: leader.email, contact_id: leader.id, template: 'visit_unbooked_reminder', kind: 'transactional', priority: 6,
        ref_type: 'group', ref_id: g.id, send_at: new Date(Date.now() + 7 * 86400000), data: d },
      { key: `grp:${g.id}:unbooked14`, to: leader.email, contact_id: leader.id, template: 'visit_unbooked_reminder', kind: 'transactional', priority: 6,
        ref_type: 'group', ref_id: g.id, send_at: new Date(Date.now() + 14 * 86400000), data: d },
    );
    await track(client, 'group_unlocked', { group_id: g.id });
  }
  await queueAndSend(context, client, rows);
}

// ---------- visits ----------
export async function visitEmails(context, client, { visit, group, leader, change, previousStartsAt, settings, tz }) {
  const env = context.env;
  const links = groupLinks(env, group);
  const authorEmail = env.AUTHOR_EMAIL || settings.visit.author_email;
  const v = visit;
  const seq = v.ics_sequence || 0;
  const leaderData = { first_name: leader.first_name, group_name: group.name, tz: tz || group.timezone, ...links,
    previous_starts_at: previousStartsAt, unsub_token: leader.unsub_token };
  const ics = { uid: `visit-${group.id}@hbdywi`, title: `Author visit: ${settings.site.author} × ${group.name}`, sequence: seq };
  const rows = [];

  await cancelPending(client, 'visit', v.id, ['visit_reminder']);
  if (change === 'cancelled') {
    rows.push({ key: `visit:${v.id}:cancel:${seq}`, to: leader.email, contact_id: leader.id, template: 'visit_cancelled', immediate: true,
      ref_type: 'group', ref_id: group.id, data: { ...leaderData, starts_at: previousStartsAt, ics: { ...ics, status: 'CANCELLED', method: 'CANCEL' } } });
  } else {
    rows.push({ key: `visit:${v.id}:${change}:${seq}`, to: leader.email, contact_id: leader.id, ref_type: 'visit', ref_id: v.id,
      template: change === 'rescheduled' ? 'visit_rescheduled' : 'visit_confirm', immediate: true, data: { ...leaderData, ics } });
    for (const r of reminderTimes(v.starts_at, [48, 1])) {
      rows.push({ key: `visit:${v.id}:r${r.hours}:${seq}`, to: leader.email, contact_id: leader.id, ref_type: 'visit', ref_id: v.id,
        template: 'visit_reminder', priority: 3, send_at: r.at, expires_at: v.starts_at, data: { ...leaderData, hours: r.hours } });
    }
    await cancelPending(client, 'group', group.id, ['visit_unbooked_reminder']);
  }
  if (authorEmail && !authorEmail.includes('{{')) {
    rows.push({ key: `visit:${v.id}:author:${change}:${seq}`, to: authorEmail, template: 'visit_author_notify', immediate: true,
      ref_type: change === 'cancelled' ? 'group' : 'visit', ref_id: change === 'cancelled' ? group.id : v.id,
      data: { change, group_name: group.name, group_goal: group.goal || '', member_count: group.member_count, leader_name: `${leader.first_name || ''} ${leader.last_name || ''}`.trim(),
              leader_email: leader.email, tz: settings.visit.timezone, previous_starts_at: previousStartsAt,
              ...(change === 'cancelled' ? { starts_at: previousStartsAt, zoom_url: v.zoom_join_url } : {}),
              ics: { ...ics, method: change === 'cancelled' ? 'CANCEL' : 'REQUEST', status: change === 'cancelled' ? 'CANCELLED' : 'CONFIRMED' } } });
  }
  await queueAndSend(context, client, rows);
}
