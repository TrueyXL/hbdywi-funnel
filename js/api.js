// API client. On Cloudflare Pages it talks to /api/*. On GitHub Pages (or ?demo=1)
// it runs a self-contained DEMO that simulates the whole funnel in localStorage,
// so the client can click through every pathway before accounts are connected.
import { activationDates, visitSlots } from './time.js';
import { store, vid } from './common.js';

export const DEMO = /github\.io$/.test(location.hostname) || location.protocol === 'file:' || new URLSearchParams(location.search).has('demo');

export async function api(path, { method = 'GET', body } = {}) {
  if (DEMO) return demo(path.replace(/^\//, ''), method, body);
  const r = await fetch('api/' + path.replace(/^\//, ''), {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.message || data.error || 'Something went wrong. Please try again.'), { data, status: r.status });
  return data;
}

export function track(type, meta = {}) {
  if (DEMO) return;
  const payload = JSON.stringify({ type, path: location.pathname + location.search.replace(/([?&]t=)[^&]+/, '$1…'), ref: document.referrer || new URLSearchParams(location.search).get('utm_source') || '', vid: vid(), meta });
  try { navigator.sendBeacon?.('api/track', new Blob([payload], { type: 'application/json' })) || fetch('api/track', { method: 'POST', body: payload, keepalive: true, headers: { 'content-type': 'application/json' } }); } catch {}
}

export function amazonHref(format = 'paperback', src = 'site') {
  if (DEMO) return 'https://www.amazon.com/s?k=' + encodeURIComponent('HBDYWI Imani Green');
  const v = vid();
  return `go/amazon?f=${encodeURIComponent(format)}&src=${encodeURIComponent(src)}&vid=${encodeURIComponent(v)}`;
}

export function demoBar() {
  if (!DEMO) return;
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.innerHTML = 'Demo preview: sample data only, no real emails, payments or bookings. <a href="https://trueyxl.github.io/hbdywi-feedback/" target="_blank" rel="noopener">Give feedback</a> · <a href="#" id="demo-reset">Reset demo</a>';
  document.body.prepend(bar);
  bar.querySelector('#demo-reset').onclick = (e) => { e.preventDefault(); localStorage.removeItem('hb_demo'); location.reload(); };
}

// ---------------------------------------------------------------- demo backend
const ERR = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const rnd = (n, chars) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => chars[b % chars.length]).join('');
const token = () => rnd(48, '0123456789abcdef');
const code = () => rnd(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
const root = () => location.href.replace(/[^/]*([?#].*)?$/, '');
const VISIT = { threshold: 5, duration_min: 30, timezone: 'America/Los_Angeles', buffer_min: 15, min_notice_hours: 48, window_days: 45, max_per_week: 3,
  weekly: { 1: [['10:00', '16:00']], 2: [['10:00', '16:00']], 3: [['10:00', '15:00']], 4: [['10:00', '16:00']] } };

function db() { return store.get('hb_demo') || { groups: {}, codes: {}, members: {} }; }
function save(d) { store.set('hb_demo', d); }
function links(g) {
  return { invite_url: `${root()}join?c=${g.code}`, dashboard_url: `${root()}group?t=${g.token}`, booking_url: `${root()}visit?t=${g.token}` };
}

async function demo(path, method, body = {}) {
  await new Promise((r) => setTimeout(r, 350));
  const [p, q] = path.split('?');
  const qs = new URLSearchParams(q || '');
  const seg = p.split('/');
  const d = db();
  const now = new Date();

  if (p === 'config') {
    const sessions = activationDates({ weekdays: [3], nth: [2, 4], time: '17:00' }, 'America/Los_Angeles', now, 2).slice(0, 4)
      .map((s, i) => ({ id: 'demo-s' + i, starts_at: s.toISOString(), duration_min: 45, full: false, seats_left: i === 0 ? 7 : null }));
    const in5w = new Date(now.getTime() + 35 * 86400000), in9w = new Date(now.getTime() + 77 * 86400000);
    return {
      site: { author: 'Imani Green', brand: 'The Bloom Project', updates_list_name: 'The Bloom Project updates', testimonials: [] },
      book: { title: 'HBDYWI', subtitle: 'Volume One', promise: 'A guided journey you were never meant to walk alone.', cover_url: null, formats: ['paperback', 'kindle'] },
      activation: { enabled: true, duration_min: 45, timezone: 'America/Los_Angeles', sessions },
      cohort: { enabled: true, waitlist_message: 'Enrollment is closed right now. Join the waitlist and you will be first to know when the next cohort opens.', cohorts: [
        { id: 'demo-c1', name: 'Winter Cohort', starts_at: in5w.toISOString(), ends_at: new Date(in5w.getTime() + 42 * 86400000).toISOString(), schedule_text: 'Tuesdays · 6:00 PM Pacific · 6 weeks', timezone: 'America/Los_Angeles', price_cents: 7200, currency: 'usd', seats_left: 9, open: true },
        { id: 'demo-c2', name: 'Spring Cohort', starts_at: in9w.toISOString(), ends_at: new Date(in9w.getTime() + 42 * 86400000).toISOString(), schedule_text: 'Thursdays · 5:00 PM Pacific · 6 weeks', timezone: 'America/Los_Angeles', price_cents: 7200, currency: 'usd', seats_left: 0, open: false },
      ] },
      visit: { threshold: 5 },
    };
  }
  if (p === 'activation/register') return { ok: true, starts_at: body.session_id };
  if (p === 'cohort/checkout') return { url: `${root()}cohort-success?demo=1` };
  if (p === 'cohort/status') return { status: 'paid', cohort: { name: 'Winter Cohort', starts_at: new Date(now.getTime() + 35 * 86400000).toISOString(), timezone: 'America/Los_Angeles' } };
  if (p === 'cohort/waitlist' || p === 'interest' || p === 'unsubscribe') return { ok: true };

  if (p === 'groups/create') {
    if (!body.group_name || !body.email) ERR('Please enter your name, a valid email and a group name.');
    const g = { id: crypto.randomUUID(), token: token(), code: code(), name: body.group_name, leader_first: body.first_name, leader_email: body.email,
      start_date: body.start_date || null, end_date: body.end_date || null, meeting_day: body.meeting_day || null, meeting_time: body.meeting_time || null,
      frequency: body.frequency || null, timezone: body.timezone || 'America/Los_Angeles', est_size: body.est_size || null, members: [], eligible_at: null, visit: null, created_at: now.toISOString() };
    d.groups[g.token] = g; d.codes[g.code] = g.token; save(d);
    return { ok: true, ...links(g), invite_code: g.code };
  }
  if (seg[0] === 'groups') {
    const g = d.groups[seg[1]]; if (!g) ERR('Not found', 404);
    if (method === 'POST') {
      if (body.demo_fill) { // demo helper: add sample members
        const names = [['Ada', 'Okafor'], ['Maya', 'Brooks'], ['Tomi', 'Adeyemi'], ['Grace', 'Liu'], ['Rosa', 'Diaz'], ['Nia', 'Hall']];
        for (const [f, l] of names.slice(0, body.demo_fill)) joinDemo(d, g, { first_name: f, last_name: l, email: `${f}.${l}.${g.members.length}@example.com`, purchased: Math.random() > .3 });
        save(d); return { ok: true };
      }
      Object.assign(g, { start_date: body.start_date || null, end_date: body.end_date || null, meeting_day: body.meeting_day || null, meeting_time: body.meeting_time || null,
        frequency: body.frequency || null, est_size: body.est_size || null, ...(body.timezone ? { timezone: body.timezone } : {}), ...(body.group_name ? { name: body.group_name } : {}) });
      save(d); return { ok: true };
    }
    return { group: g, leader: { first_name: g.leader_first }, member_count: g.members.length, threshold: 5, eligible: !!g.eligible_at, eligible_at: g.eligible_at,
      members: g.members.map((m) => ({ name: `${m.first_name} ${m.last_name[0]}.`, purchased: m.purchased, joined: m.created_at })), visit: g.visit, ...links(g) };
  }
  if (seg[0] === 'join') {
    const g = d.groups[d.codes[(seg[1] || '').toUpperCase()]];
    if (!g) ERR('Invite link not found', 404);
    if (method === 'GET') return { name: g.name, leader_first_name: g.leader_first, meeting_day: g.meeting_day, meeting_time: g.meeting_time, frequency: g.frequency,
      timezone: g.timezone, start_date: g.start_date, member_count: g.members.length, threshold: 5, updates_list_name: 'The Bloom Project updates' };
    const r = joinDemo(d, g, { ...body, purchased: body.purchased === 'yes' || body.purchased === true }); save(d);
    return { ok: true, ...r, group_name: g.name, threshold: 5, member_url: `member?t=${r.member_token}&demo=1` };
  }
  if (seg[0] === 'member') {
    const ref = d.members[seg[1]]; if (!ref) ERR('Not found', 404);
    const m = d.groups[ref.g].members.find((x) => x.member_token === seg[1]);
    if (method === 'POST') { if (body.purchased !== undefined) m.purchased = body.purchased === true || body.purchased === 'yes'; if (body.opt_in !== undefined) m.opt_in = !!body.opt_in; save(d); return { ok: true }; }
    return { first_name: m.first_name, purchased: m.purchased, group_name: d.groups[ref.g].name, opt_in: !!m.opt_in };
  }
  if (p === 'visit/slots') {
    const g = d.groups[qs.get('t')]; if (!g) ERR('Not found', 404);
    const booked = Object.values(d.groups).filter((x) => x !== g && x.visit?.status === 'booked').map((x) => x.visit);
    return { group: { name: g.name, timezone: g.timezone, member_count: g.members.length }, threshold: 5, eligible: !!g.eligible_at, author_timezone: VISIT.timezone,
      duration_min: 30, min_notice_hours: 48, visit: g.visit, slots: g.eligible_at ? visitSlots(VISIT, booked, [], now) : [] };
  }
  if (p === 'visit/book') {
    const g = d.groups[body.t]; if (!g) ERR('Not found', 404);
    if (!g.eligible_at) ERR('Your group unlocks the visit once 5 members have joined.', 403);
    if (g.visit?.status === 'completed') ERR('Your group has already had its complimentary visit.', 409);
    const rescheduled = g.visit?.status === 'booked';
    g.visit = { starts_at: new Date(body.starts_at).toISOString(), status: 'booked', duration_min: 30, zoom_url: 'https://zoom.us/j/0000000000' };
    save(d); return { ok: true, rescheduled, starts_at: g.visit.starts_at, zoom_url: g.visit.zoom_url };
  }
  if (p === 'visit/cancel') {
    const g = d.groups[body.t]; if (!g?.visit) ERR('There is no booked visit to cancel.', 409);
    g.visit.status = 'cancelled'; g.visit.zoom_url = null; save(d); return { ok: true };
  }
  ERR('This feature needs the live backend (admin is not available in the demo).', 501);
}

function joinDemo(d, g, b) {
  const email = String(b.email || '').trim().toLowerCase();
  if (!b.first_name || !b.last_name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) ERR('Please enter your first name, last name and a valid email.');
  let m = g.members.find((x) => x.email === email);
  const already = !!m;
  if (m) Object.assign(m, { first_name: b.first_name, last_name: b.last_name, purchased: b.purchased });
  else { m = { email, first_name: b.first_name, last_name: b.last_name, purchased: b.purchased, member_token: token(), created_at: new Date().toISOString() }; g.members.push(m); d.members[m.member_token] = { g: g.token }; }
  let just_unlocked = false;
  if (g.members.length >= 5 && !g.eligible_at) { g.eligible_at = new Date().toISOString(); just_unlocked = true; }
  return { already_member: already, member_count: g.members.length, just_unlocked, member_token: m.member_token };
}
