// API client. On Cloudflare Pages it talks to /api/*. On GitHub Pages (or ?demo=1)
// it runs a self-contained DEMO that simulates the whole funnel in localStorage,
// so the client can click through every pathway before accounts are connected.
import { activationDates, visitSlots } from './time.js';
import { store, vid, applyTheme, THEMES, $$ } from './common.js';

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
  const cur = store.get('hb_demo_theme') || 'brand';
  bar.innerHTML = 'Demo preview: sample data only, no real emails, payments or bookings. '
    + '<label>Season look <select id="demo-season">' + Object.entries(THEMES).map(([k, t]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${t.label}</option>`).join('') + '</select></label> · '
    + '<a href="https://trueyxl.github.io/hbdywi-feedback/" target="_blank" rel="noopener">Give feedback</a> · <a href="#" id="demo-reset">Reset demo</a>';
  document.body.prepend(bar);
  bar.querySelector('#demo-reset').onclick = (e) => { e.preventDefault(); localStorage.removeItem('hb_demo'); location.reload(); };
  bar.querySelector('#demo-season').onchange = (e) => { store.set('hb_demo_theme', e.target.value); applyTheme({ preset: e.target.value }); };
}

/** Apply the admin-chosen theme + brand name on any page. Returns the public config. */
export async function loadSite() {
  let cfg = null;
  try { cfg = await api('config'); } catch { return null; }
  if (cfg?.site?.theme) applyTheme(cfg.site.theme);
  if (cfg?.site?.brand) $$('[data-bind="brand"]').forEach((el) => (el.textContent = cfg.site.brand));
  return cfg;
}

// ---------------------------------------------------------------- demo backend
const ERR = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const rnd = (n, chars) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => chars[b % chars.length]).join('');
const token = () => rnd(48, '0123456789abcdef');
const code = () => rnd(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
const root = () => location.href.replace(/[^/]*([?#].*)?$/, '');
const VISIT = { threshold: 5, duration_min: 30, timezone: 'America/Los_Angeles', buffer_min: 15, min_notice_hours: 48, window_days: 45, max_per_week: 3,
  weekly: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '15:00']] } };
// Demo stand-in for Imani's Google Calendar: a few "busy" blocks so the demo shows times disappearing.
function demoCalendarBusy(now) {
  const out = [];
  for (let i = 0; i < 45; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const day = d.getUTCDay();
    const at = (h, m = 0) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h + 8, m)); return x.toISOString(); }; // ≈ Pacific
    if (day === 1) out.push({ start: at(9), end: at(12) });          // Monday mornings blocked
    if (day === 3) out.push({ start: at(13), end: at(17) });         // Wednesday afternoons blocked
    if (i % 9 === 4) out.push({ start: at(9), end: at(17) });        // the odd full day off
  }
  return out;
}

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
    const sessions = activationDates({ weekdays: [3], nth: [2, 4], time: '18:00' }, 'America/Los_Angeles', now, 2).slice(0, 4)
      .map((s, i) => ({ id: 'demo-s' + i, starts_at: s.toISOString(), duration_min: 45, full: false, seats_left: i === 0 ? 7 : null }));
    // next Monday 6 PM Pacific (≈ 02:00 UTC Tuesday) at least N weeks out
    const monday = (weeks) => { const d = new Date(now.getTime() + weeks * 7 * 86400000); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); d.setUTCHours(2, 0, 0, 0); return d; };
    const in5w = monday(4), in9w = monday(10);
    return {
      site: { author: 'Imani Green', brand: 'How Bad Do You Want It?', updates_list_name: 'How Bad Do You Want It? updates', theme: { preset: store.get('hb_demo_theme') || 'brand' },
        author_photo_url: '', author_bio: '', volumes: ['Volume One'],
        excerpt: { title: 'A taste of Volume One', text: '', pdf_url: '' },
        testimonials: [
          { quote: 'Sample testimonial: this is where a reader’s words about the book will go.', name: 'Reader name · City' },
          { quote: 'Sample testimonial: a short line about what changed for them after the cohort.', name: 'Cohort member' },
          { quote: 'Sample testimonial: why reading it with their circle made the difference.', name: 'Circle leader' },
        ] },
      book: { title: 'How Bad Do You Want It?', subtitle: 'Volume One', promise: null, cover_url: null, formats: ['paperback', 'hardcover'] },
      activation: { enabled: true, duration_min: 45, timezone: 'America/Los_Angeles', sessions },
      cohort: { enabled: true, waitlist_message: 'Enrollment is closed right now. Join the waitlist and you will be first to know when the next cohort opens.', cohorts: [
        { id: 'demo-c1', name: 'Winter Cohort', starts_at: in5w.toISOString(), ends_at: new Date(in5w.getTime() + 24 * 86400000).toISOString(), schedule_text: 'Mondays · 6:00 PM Pacific · 2 hours', timezone: 'America/Los_Angeles', price_cents: 7200, currency: 'usd', capacity: 25, seats_left: 9, open: true },
        { id: 'demo-c2', name: 'Spring Cohort', starts_at: in9w.toISOString(), ends_at: new Date(in9w.getTime() + 24 * 86400000).toISOString(), schedule_text: 'Mondays · 6:00 PM Pacific · 2 hours', timezone: 'America/Los_Angeles', price_cents: 7200, currency: 'usd', capacity: 25, seats_left: 0, open: false },
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
      frequency: body.frequency || null, timezone: body.timezone || 'America/Los_Angeles', est_size: body.est_size || null, goal: body.goal || null, members: [], eligible_at: null, visit: null, created_at: now.toISOString() };
    d.groups[g.token] = g; d.codes[g.code] = g.token; save(d);
    return { ok: true, ...links(g), invite_code: g.code };
  }
  if (seg[0] === 'groups') {
    const g = d.groups[seg[1]]; if (!g) ERR('Not found', 404);
    if (method === 'POST') {
      if (body.demo_fill) { // demo helper: add sample members
        const names = [['Ada', 'Okafor'], ['Maya', 'Brooks'], ['Tomi', 'Adeyemi'], ['Grace', 'Liu'], ['Rosa', 'Diaz'], ['Nia', 'Hall']];
        for (const [f, l] of names.slice(0, body.demo_fill)) joinDemo(d, g, { first_name: f, last_name: l, email: `${f}.${l}.${g.members.length}@example.com`, purchased_volume: Math.random() > .3 ? 'Volume One' : 'none' });
        save(d); return { ok: true };
      }
      if (body.resend) return { ok: true, sent_to: g.leader_email };
      Object.assign(g, { start_date: body.start_date || null, end_date: body.end_date || null, meeting_day: body.meeting_day || null, meeting_time: body.meeting_time || null,
        frequency: body.frequency || null, est_size: body.est_size || null, ...(body.goal !== undefined ? { goal: body.goal || null } : {}), ...(body.timezone ? { timezone: body.timezone } : {}), ...(body.group_name ? { name: body.group_name } : {}) });
      save(d); return { ok: true };
    }
    return { group: g, leader: { first_name: g.leader_first }, member_count: g.members.length, threshold: 5, eligible: !!g.eligible_at, eligible_at: g.eligible_at,
      members: g.members.map((m) => ({ name: `${m.first_name} ${m.last_name[0]}.`, purchased: m.purchased, purchased_volume: m.purchased_volume, joined: m.created_at })), visit: g.visit, ...links(g) };
  }
  if (seg[0] === 'join') {
    const g = d.groups[d.codes[(seg[1] || '').toUpperCase()]];
    if (!g) ERR('Invite link not found', 404);
    if (method === 'GET') return { name: g.name, leader_first_name: g.leader_first, meeting_day: g.meeting_day, meeting_time: g.meeting_time, frequency: g.frequency,
      timezone: g.timezone, start_date: g.start_date, member_count: g.members.length, threshold: 5, updates_list_name: 'How Bad Do You Want It? updates', volumes: ['Volume One'] };
    const r = joinDemo(d, g, body); save(d);
    return { ok: true, ...r, group_name: g.name, threshold: 5, purchased: r.purchased, member_url: `member?t=${r.member_token}&demo=1` };
  }
  if (seg[0] === 'member') {
    const ref = d.members[seg[1]]; if (!ref) ERR('Not found', 404);
    const m = d.groups[ref.g].members.find((x) => x.member_token === seg[1]);
    if (method === 'POST') { if (body.purchased_volume !== undefined) { m.purchased_volume = body.purchased_volume; m.purchased = body.purchased_volume !== 'none'; } if (body.opt_in !== undefined) m.opt_in = !!body.opt_in; save(d); return { ok: true }; }
    return { first_name: m.first_name, purchased: m.purchased, purchased_volume: m.purchased_volume || (m.purchased ? 'Volume One' : 'none'), volumes: ['Volume One'], group_name: d.groups[ref.g].name, opt_in: !!m.opt_in };
  }
  if (p === 'visit/slots') {
    const g = d.groups[qs.get('t')]; if (!g) ERR('Not found', 404);
    const booked = Object.values(d.groups).filter((x) => x !== g && x.visit?.status === 'booked').map((x) => x.visit);
    return { group: { name: g.name, timezone: g.timezone, member_count: g.members.length }, threshold: 5, eligible: !!g.eligible_at, author_timezone: VISIT.timezone,
      duration_min: 30, min_notice_hours: 48, visit: g.visit, slots: g.eligible_at ? visitSlots(VISIT, booked, [], now, demoCalendarBusy(now)) : [] };
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
  const vol = b.purchased_volume || (b.purchased === 'yes' ? 'Volume One' : 'none');
  if (!vol) ERR('Please tell us which volume you have purchased.');
  const purchased = vol !== 'none';
  if (m) Object.assign(m, { first_name: b.first_name, last_name: b.last_name, purchased, purchased_volume: vol });
  else { m = { email, first_name: b.first_name, last_name: b.last_name, purchased, purchased_volume: vol, member_token: token(), created_at: new Date().toISOString() }; g.members.push(m); d.members[m.member_token] = { g: g.token }; }
  let just_unlocked = false;
  if (g.members.length >= 5 && !g.eligible_at) { g.eligible_at = new Date().toISOString(); just_unlocked = true; }
  return { already_member: already, member_count: g.members.length, just_unlocked, member_token: m.member_token, purchased };
}
