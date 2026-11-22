import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zonedToUtc, activationDates, visitSlots, reminderTimes, weekKey, nthWeekdays } from '../functions/_lib/time.js';
import { TEMPLATES, render, fill } from '../functions/_lib/templates.js';
import { verifyWebhook } from '../functions/_lib/stripe.js';
import { activationRows } from '../functions/_lib/flows.js';
import { DEFAULT_SETTINGS } from '../functions/_lib/db.js';

test('browser copy of time.js is in sync', () => {
  assert.equal(readFileSync('public/js/time.js', 'utf8'), readFileSync('functions/_lib/time.js', 'utf8'), 'run: npm run sync');
});

test('zonedToUtc handles PST and PDT', () => {
  assert.equal(zonedToUtc(2027, 1, 13, 17, 0, 'America/Los_Angeles').toISOString(), '2027-01-14T01:00:00.000Z'); // PST -8
  assert.equal(zonedToUtc(2027, 7, 14, 17, 0, 'America/Los_Angeles').toISOString(), '2027-07-15T00:00:00.000Z'); // PDT -7
});

test('2nd and 4th Wednesdays at 5 PM Pacific', () => {
  assert.deepEqual(nthWeekdays(2027, 1, 3, [2, 4]), [13, 27]);
  const d = activationDates({ weekdays: [3], nth: [2, 4], time: '17:00' }, 'America/Los_Angeles', new Date('2027-01-02T12:00:00Z'), 1);
  assert.deepEqual(d.map((x) => x.toISOString()), ['2027-01-14T01:00:00.000Z', '2027-01-28T01:00:00.000Z', '2027-02-11T01:00:00.000Z', '2027-02-25T01:00:00.000Z']);
});

test('late signups skip reminders that already passed', () => {
  const start = '2027-01-14T01:00:00.000Z';
  const early = reminderTimes(start, [48, 24, 1], new Date('2027-01-10T00:00:00Z'));
  assert.deepEqual(early.map((r) => r.hours), [48, 24, 1]);
  const late = reminderTimes(start, [48, 24, 1], new Date('2027-01-13T12:00:00Z')); // 13h before
  assert.deepEqual(late.map((r) => r.hours), [1]);
  assert.deepEqual(reminderTimes(start, [48, 24, 1], new Date('2027-01-14T00:30:00Z')).map((r) => r.hours), []); // 30 min before
});

test('activationRows: confirmation always, only future reminders, follow-up after session', () => {
  const session = { id: 's1', starts_at: new Date(Date.now() + 20 * 3600000).toISOString(), duration_min: 45 };
  const rows = activationRows({ reg: 'r1', contact: { id: 'c1', email: 'a@b.co', first_name: 'A' }, session, tz: 'America/Toronto', settings: DEFAULT_SETTINGS, unsub: 'u' });
  const t = rows.map((r) => r.template + (r.data.hours ? ':' + r.data.hours : ''));
  assert.deepEqual(t, ['activation_confirm', 'activation_reminder:1', 'activation_next_steps']);
  // with 48h and 24h dropped because they passed:
  assert.ok(!rows.some((r) => r.data.hours === 48 || r.data.hours === 24));
  assert.equal(rows.find((r) => r.template === 'activation_next_steps').kind, 'followup');
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'dedupe keys unique');
});

test('visit slots respect notice, buffer, other bookings, blackouts and weekly cap', () => {
  const cfg = { timezone: 'America/Los_Angeles', duration_min: 30, buffer_min: 15, min_notice_hours: 48, window_days: 14, max_per_week: 2,
    weekly: { 1: [['10:00', '11:30']] } }; // Mondays 10:00-11:30 → 10:00, 10:45
  const now = new Date('2027-01-01T12:00:00Z'); // Friday
  const all = visitSlots(cfg, [], [], now);
  assert.deepEqual(all.slice(0, 2), ['2027-01-04T18:00:00.000Z', '2027-01-04T18:45:00.000Z']);
  // booking at 10:00 blocks 10:00 and the buffered 10:45? 10:00-10:30 +15 buffer → 10:45 is free
  const s2 = visitSlots(cfg, [{ starts_at: '2027-01-04T18:00:00.000Z', duration_min: 30 }], [], now);
  assert.ok(!s2.includes('2027-01-04T18:00:00.000Z'));
  assert.ok(s2.includes('2027-01-04T18:45:00.000Z'));
  // weekly cap 2: two bookings that week → nothing left that week
  const s3 = visitSlots({ ...cfg, max_per_week: 1 }, [{ starts_at: '2027-01-04T18:00:00.000Z', duration_min: 30 }], [], now);
  assert.ok(!s3.some((s) => weekKey(new Date(s), cfg.timezone) === '2027-01-04'));
  // blackout
  assert.ok(!visitSlots(cfg, [], ['2027-01-04'], now).some((s) => s.startsWith('2027-01-04')));
  // min notice: now = Sunday → Monday slots < 48h are excluded
  assert.ok(!visitSlots(cfg, [], [], new Date('2027-01-03T12:00:00Z')).some((s) => s.startsWith('2027-01-04')));
});

test('every template renders with sample data and no leftover placeholders', () => {
  const vars = new Proxy({ first_name: 'Ada', cohort_open: true }, { get: (t, k) => (k in t ? t[k] : 'X') });
  for (const key of Object.keys(TEMPLATES)) {
    const out = render(key, vars, null, { brand: 'B', unsubscribeUrl: 'https://x/u', kind: 'followup' });
    assert.ok(out.subject && !/\{\{/.test(out.subject + out.html + out.text), key);
  }
});

test('conditionals', () => {
  assert.equal(fill('{{#if a}}A{{/if}}{{#unless b}}B{{/unless}}', { a: true, b: false }), 'AB');
  assert.equal(fill('{{#unless has_paid_cohort}}{{#if cohort_open}}X{{/if}}{{/unless}}', { has_paid_cohort: true, cohort_open: true }), '');
  assert.equal(fill('{{name}}', { name: '<b>' }), '&lt;b&gt;');
});

test('Stripe signature verification', async () => {
  const secret = 'whsec_test', body = JSON.stringify({ id: 'evt_1', type: 'x', data: { object: {} } }), t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`))).toString('hex');
  assert.equal((await verifyWebhook(body, `t=${t},v1=${sig}`, secret)).id, 'evt_1');
  await assert.rejects(verifyWebhook(body, `t=${t},v1=deadbeef`, secret));
  await assert.rejects(verifyWebhook(body, `t=${t - 1000},v1=${sig}`, secret));
});

test('Google Calendar busy blocks (plus buffer) remove visit slots', () => {
  const cfg = { timezone: 'America/Los_Angeles', duration_min: 30, buffer_min: 15, min_notice_hours: 0, window_days: 7, max_per_week: 10,
    weekly: { 1: [['10:00', '12:15']] } }; // Monday 10:00, 10:45, 11:30
  const now = new Date('2027-01-01T12:00:00Z');
  const free = visitSlots(cfg, [], [], now);
  assert.deepEqual(free.filter((s) => s.startsWith('2027-01-04')), ['2027-01-04T18:00:00.000Z', '2027-01-04T18:45:00.000Z', '2027-01-04T19:30:00.000Z']);
  // Imani blocks 10:30-11:00 PT in Google → 10:00 (ends 10:30, buffer 15) and 10:45 clash; 11:30 is outside 11:00+15
  const busy = [{ start: '2027-01-04T18:30:00Z', end: '2027-01-04T19:00:00Z' }];
  assert.deepEqual(visitSlots(cfg, [], [], now, busy).filter((s) => s.startsWith('2027-01-04')), ['2027-01-04T19:30:00.000Z']);
  // all-day block wipes the day; junk entries are ignored
  const allDay = [{ start: '2027-01-04T08:00:00Z', end: '2027-01-05T08:00:00Z' }, { start: 'x', end: 'y' }];
  assert.equal(visitSlots(cfg, [], [], now, allDay).filter((s) => s.startsWith('2027-01-04')).length, 0);
});

test('v2 defaults: Activation at 6 PM Pacific, brand renamed, Accountability Circle copy', () => {
  assert.equal(DEFAULT_SETTINGS.activation.rule.time, '18:00');
  const d = activationDates(DEFAULT_SETTINGS.activation.rule, 'America/Los_Angeles', new Date('2027-01-02T12:00:00Z'), 1);
  assert.equal(d[0].toISOString(), '2027-01-14T02:00:00.000Z'); // Wed Jan 13 2027 18:00 PST
  assert.equal(DEFAULT_SETTINGS.site.brand, 'How Bad Do You Want It?');
  const all = JSON.stringify(TEMPLATES);
  assert.ok(!/Bloom Project|reading group/i.test(all), 'no old brand / reading-group wording in emails');
  assert.ok(TEMPLATES.group_links && TEMPLATES.visit_author_notify.body.includes('group_goal'));
});
