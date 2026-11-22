import { $, $$, fmt, esc, money, say, busy, formData, viewerTz, THEMES } from './common.js';
import { DEMO } from './api.js';
import { zonedToUtc } from './time.js';

let KEY = sessionStorage.getItem('hb_admin') || '';
const tz = viewerTz();
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let SETTINGS = null, BOOK = null;

async function A(path, { method = 'GET', body } = {}) {
  const r = await fetch('api/admin/' + path, { method, headers: { 'x-admin-key': KEY, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { logout(); throw new Error('Wrong password'); }
  if ((r.headers.get('content-type') || '').includes('text/csv')) return r.blob();
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || d.error || 'Request failed');
  return d;
}
const when = (iso, z = tz) => (iso ? fmt(iso, z, { year: 'numeric', timeZoneName: 'short' }) : '—');
const btn = (label, attrs = '', cls = 'ghost') => `<button class="btn sm ${cls}" type="button" ${attrs}>${label}</button>`;

// ---------- auth ----------
function logout() { sessionStorage.removeItem('hb_admin'); KEY = ''; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
$('#logout').onclick = logout;
$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  if (DEMO) return say($('#login-msg'), 'Admin needs the live backend (Cloudflare + Supabase). It is not available in the GitHub demo.');
  KEY = $('#pw').value;
  try { await A('stats?days=1'); sessionStorage.setItem('hb_admin', KEY); start(); } catch (err) { say($('#login-msg'), err.message); }
};

// ---------- tabs ----------
const loaders = { overview: loadStats, activation: loadSessions, cohorts: loadCohorts, groups: loadGroups, visits: loadVisits, emails: loadTemplates, settings: loadSettings, data: loadOutbox };
$$('[data-tab]').forEach((b) => (b.onclick = () => {
  $$('[data-tab]').forEach((x) => x.setAttribute('aria-selected', x === b));
  $$('.panel').forEach((p) => p.classList.toggle('on', p.id === 'p-' + b.dataset.tab));
  loaders[b.dataset.tab]().catch((e) => alertBox(e));
}));
const alertBox = (e) => console.error(e);

async function start() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  const s = await A('settings'); SETTINGS = s.settings; BOOK = s.books.find((b) => b.is_current) || s.books[0];
  loadStats();
}

// ---------- overview ----------
$('#days').onchange = loadStats;
async function loadStats() {
  const s = await A('stats?days=' + $('#days').value);
  const e = s.events || {};
  const k = [
    ['Page views', e.page_view || 0], ['Unique visitors', s.unique_visitors], ['Amazon clicks', e.amazon_click || 0],
    ['Activation sign-ups', s.activation_signups], ['Cohort payments', s.cohort_paid], ['Cohort revenue', money(s.cohort_revenue_cents)],
    ['Groups created', s.groups_created], ['Member sign-ups', s.members_joined], ['Groups unlocked (all time)', s.groups_eligible],
    ['Visits booked (upcoming)', s.visits_booked], ['Visits completed', s.visits_completed], ['Waitlist joins', e.waitlist_join || 0],
  ];
  $('#kpis').innerHTML = k.map(([l, v]) => `<div class="kpi"><b>${esc(v)}</b><span>${l}</span></div>`).join('');
  const limit = SETTINGS?.email?.daily_limit || 95;
  $('#email-health').innerHTML = `Emails today: <b>${s.emails_sent_today}</b> of ${limit} daily limit · ${s.emails_pending} scheduled.` +
    (s.emails_sent_today > limit * 0.8 ? ' <b style="color:var(--warn)">Close to the free Resend limit. Consider upgrading to Resend Pro.</b>' : '');
}

// ---------- activation ----------
async function loadSessions() {
  const rows = await A('sessions');
  $('#sessions').innerHTML = '<thead><tr><th>When</th><th>Registered</th><th>Status</th><th>Zoom</th><th></th></tr></thead><tbody>' + rows.map((s) => `
    <tr><td>${esc(when(s.starts_at))}</td><td>${s.activation_registrations?.[0]?.count || 0}${s.capacity ? ' / ' + s.capacity : ''}</td><td>${esc(s.status)}</td>
    <td class="small">${s.zoom_url ? 'custom' : 'default'}</td>
    <td style="white-space:nowrap">${btn('People', `data-regs="${s.id}"`)} ${s.status === 'scheduled' ? btn('Edit', `data-edit="${s.id}" data-at="${s.starts_at}" data-zoom="${esc(s.zoom_url || '')}" data-cap="${s.capacity || ''}"`) + ' ' + btn('Cancel', `data-cancel="${s.id}"`) : ''}</td></tr>`).join('') + '</tbody>';
  $$('[data-regs]').forEach((b) => (b.onclick = async () => {
    const r = await A(`sessions/${b.dataset.regs}/registrants`);
    $('#regs').innerHTML = `<div class="card"><h3>${r.length} registrant${r.length === 1 ? '' : 's'}</h3><div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Opted in</th><th>Registered</th></tr></thead><tbody>${r.map((x) => `<tr><td>${esc(x.contacts.first_name)} ${esc(x.contacts.last_name || '')}</td><td>${esc(x.contacts.email)}</td><td>${x.contacts.marketing_opt_in ? 'Yes' : 'No'}</td><td>${esc(when(x.created_at))}</td></tr>`).join('')}</tbody></table></div></div>`;
  }));
  $$('[data-cancel]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Cancel this session? Everyone registered gets a cancellation email with a link to pick a new date.')) return;
    const r = await A('sessions/' + b.dataset.cancel, { method: 'PATCH', body: { status: 'cancelled' } }); loadSessions(); alert(`Cancelled. ${r.notified} people notified.`);
  }));
  $$('[data-edit]').forEach((b) => (b.onclick = async () => {
    const local = new Date(new Date(b.dataset.at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const at = prompt('New date & time (your device time, YYYY-MM-DDTHH:MM). Leave unchanged to keep.', local); if (at === null) return;
    const zoom = prompt('Zoom link for this session (blank = default)', b.dataset.zoom); if (zoom === null) return;
    const cap = prompt('Seat limit (blank = none)', b.dataset.cap); if (cap === null) return;
    const body = { zoom_url: zoom, capacity: cap ? +cap : '' };
    if (at !== local) body.starts_at = new Date(at).toISOString();
    const r = await A('sessions/' + b.dataset.edit, { method: 'PATCH', body }); loadSessions();
    if (body.starts_at) alert(`Updated. ${r.notified} registrants were sent the new time.`);
  }));
}
$('#new-session').onsubmit = async (e) => {
  e.preventDefault(); const d = formData(e.currentTarget);
  await A('sessions', { method: 'POST', body: { starts_at: new Date(d.starts_at).toISOString(), zoom_url: d.zoom_url || null, capacity: d.capacity ? +d.capacity : null } });
  e.currentTarget.reset(); loadSessions();
};

// ---------- cohorts ----------
let COHORTS = [];
async function loadCohorts() {
  COHORTS = await A('cohorts');
  $('#cohorts').innerHTML = '<thead><tr><th>Cohort</th><th>Starts</th><th>Paid / seats</th><th>Status</th><th></th></tr></thead><tbody>' + COHORTS.map((c) => {
    const paid = (c.cohort_enrollments || []).filter((e) => e.status === 'paid').length;
    return `<tr><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.schedule_text || '')}</div></td><td>${esc(when(c.starts_at, c.timezone))}</td><td>${paid} / ${c.capacity}</td><td>${esc(c.status)}</td>
      <td style="white-space:nowrap">${btn('Edit', `data-cedit="${c.id}"`)} ${btn('People', `data-cpeople="${c.id}"`)} ${c.status === 'open' ? btn('Email waitlist', `data-cwait="${c.id}"`) : ''}</td></tr>`;
  }).join('') + '</tbody>';
  $$('[data-cedit]').forEach((b) => (b.onclick = () => openCohort(COHORTS.find((c) => c.id === b.dataset.cedit))));
  $$('[data-cpeople]').forEach((b) => (b.onclick = async () => {
    const r = await A(`cohorts/${b.dataset.cpeople}/enrollments`);
    $('#enrolls').innerHTML = `<div class="card"><h3>Enrollments</h3><div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Paid</th></tr></thead><tbody>${r.map((x) => `<tr><td>${esc(x.contacts.first_name)} ${esc(x.contacts.last_name || '')}</td><td>${esc(x.contacts.email)}</td><td>${esc(x.status)}</td><td>${x.paid_at ? esc(when(x.paid_at)) + ' · ' + money(x.amount_cents || 0) : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
  }));
  $$('[data-cwait]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Email everyone on the waitlist (not yet notified) that this cohort is open?')) return;
    const r = await A(`cohorts/${b.dataset.cwait}/notify-waitlist`, { method: 'POST', body: {} }); alert(`${r.queued} waitlist emails queued.`);
  }));
}
function localParts(iso, z) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const o = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}`;
}
function openCohort(c = null) {
  const f = $('#cohort-form'); f.reset(); f.classList.remove('hidden'); say($('#cohort-msg'), '');
  $('#cohort-form-h').textContent = c ? 'Edit cohort' : 'New cohort';
  if (c) {
    for (const k of ['id', 'name', 'status', 'capacity', 'timezone', 'meeting_minutes', 'schedule_text', 'zoom_url', 'workbook_url', 'instructions']) if (f[k]) f[k].value = c[k] ?? '';
    f.price.value = (c.price_cents / 100).toFixed(2);
    f.meetings.value = (c.meeting_times || []).map((t) => localParts(t, c.timezone)).join('\n');
  }
  f.scrollIntoView({ behavior: 'smooth' });
}
$('#new-cohort').onclick = () => openCohort();
$('#cohort-cancel').onclick = () => $('#cohort-form').classList.add('hidden');
$('#cohort-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.currentTarget, d = formData(f), z = d.timezone || 'America/Los_Angeles';
  try {
    const meetings = d.meetings.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/); if (!m) throw new Error('Meeting line not understood: ' + l);
      return zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], z).toISOString();
    }).sort();
    if (!meetings.length) throw new Error('Add at least one meeting date.');
    const body = { name: d.name, status: d.status, price_cents: Math.round(+d.price * 100), capacity: +d.capacity, timezone: z, meeting_times: meetings,
      starts_at: meetings[0], ends_at: new Date(new Date(meetings.at(-1)).getTime() + (+d.meeting_minutes || 60) * 60000).toISOString(),
      meeting_minutes: +d.meeting_minutes || 60, schedule_text: d.schedule_text, zoom_url: d.zoom_url, workbook_url: d.workbook_url, instructions: d.instructions };
    if (BOOK && !d.id) body.book_id = BOOK.id;
    await A(d.id ? 'cohorts/' + d.id : 'cohorts', { method: d.id ? 'PATCH' : 'POST', body });
    say($('#cohort-msg'), d.id ? 'Saved. Reminders for paid participants were re-synced.' : 'Cohort created.', 'ok'); loadCohorts();
  } catch (err) { say($('#cohort-msg'), err.message); }
};

// ---------- groups ----------
let GROUPS = [];
$('#gsearch').oninput = renderGroups;
async function loadGroups() { GROUPS = await A('groups'); renderGroups(); }
function renderGroups() {
  const q = $('#gsearch').value.toLowerCase();
  const rows = GROUPS.filter((g) => !q || `${g.name} ${g.leader_name} ${g.leader_email}`.toLowerCase().includes(q));
  $('#groups').innerHTML = '<thead><tr><th>Group</th><th>Leader</th><th>Members</th><th>Has book</th><th>Unlocked</th><th>Visit</th><th></th></tr></thead><tbody>' + rows.map((g) => `
    <tr><td><b>${esc(g.name)}</b><div class="small muted">${esc(g.invite_code)} · ${esc(g.meeting_day || '')} ${esc(g.meeting_time || '')}</div></td>
    <td>${esc(g.leader_name)}<div class="small muted">${esc(g.leader_email)}</div></td><td>${g.member_count}${g.est_size ? ` <span class="small muted">(est ${g.est_size})</span>` : ''}</td><td>${g.purchased_yes}</td>
    <td>${g.eligible_at ? '✓ ' + esc(when(g.eligible_at).split(',').slice(0, 2).join(',')) : '—'}</td>
    <td>${g.visit_status ? esc(g.visit_status) + '<div class="small muted">' + esc(when(g.visit_starts_at)) + '</div>' : '—'}</td>
    <td>${btn('Open', `data-g="${g.id}"`)}</td></tr>`).join('') + '</tbody>';
  $$('[data-g]').forEach((b) => (b.onclick = () => openGroup(b.dataset.g)));
}
async function openGroup(id) {
  const g = await A('groups/' + id);
  $('#group-detail').innerHTML = `<div class="card"><h3>${esc(g.name)}</h3>
    <p class="small">Invite: <a href="${esc(g.invite_url)}" target="_blank">${esc(g.invite_url)}</a><br>Leader dashboard: <a href="${esc(g.dashboard_url)}" target="_blank">open</a> · Booking page: <a href="${esc(g.booking_url)}" target="_blank">open</a></p>
    <p class="small muted">Dates: ${esc(g.start_date || '?')} → ${esc(g.end_date || '?')} · ${esc(g.frequency || '')} · ${esc(g.timezone)}</p>
    ${g.goal ? `<p><b>What they want to achieve:</b><br><span style="white-space:pre-line">${esc(g.goal)}</span></p>` : ''}
    ${btn('Resend leader email', `id="resend"`, '')}
    <div class="scroll-x" style="margin-top:14px"><table class="table"><thead><tr><th>Member</th><th>Email</th><th>Purchased</th><th>Joined</th></tr></thead><tbody>${g.members.map((m) => `<tr><td>${esc(m.first_name)} ${esc(m.last_name)}</td><td>${esc(m.email)}</td><td>${m.purchased ? esc(m.purchased_volume && m.purchased_volume !== 'none' ? m.purchased_volume : 'Yes') : 'No'}</td><td>${esc(when(m.created_at))}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#resend').onclick = async () => { const r = await A(`groups/${id}/resend-invite`, { method: 'POST', body: {} }); alert(`Sent (${r.template === 'group_eligible' ? 'booking link' : 'invite link'}).`); };
}

// ---------- visits & availability ----------
async function loadVisits() {
  const [rows, blk, s] = await Promise.all([A('visits'), A('blackouts'), A('settings')]);
  SETTINGS = s.settings;
  const v = SETTINGS.visit;
  $('#visits').innerHTML = '<thead><tr><th>Group</th><th>When (Imani)</th><th>Status</th><th>Zoom</th><th></th></tr></thead><tbody>' + rows.map((x) => `
    <tr><td>${esc(x.groups?.name)}<div class="small muted">${x.groups?.member_count} members · rescheduled ${x.reschedule_count}×</div></td><td>${esc(when(x.starts_at, v.timezone))}</td><td>${esc(x.status)}</td>
    <td>${x.zoom_join_url ? `<a href="${esc(x.zoom_join_url)}" target="_blank">link</a>` : '—'}</td>
    <td>${x.status === 'booked' ? btn('Mark completed', `data-done="${x.id}"`) : ''} <a class="btn sm ghost" target="_blank" href="visit?t=${esc(x.groups?.leader_token)}">Booking page</a></td></tr>`).join('') + '</tbody>';
  $$('[data-done]').forEach((b) => (b.onclick = async () => { await A('visits/' + b.dataset.done, { method: 'PATCH', body: { status: 'completed' } }); loadVisits(); }));
  const f = $('#avail');
  f.weekly.value = Object.entries(v.weekly || {}).sort().map(([d, w]) => `${DAYS[d]} ${w.map(([a, b]) => `${a}-${b}`).join(', ')}`).join('\n');
  for (const k of ['timezone', 'min_notice_hours', 'window_days', 'buffer_min', 'max_per_week', 'threshold', 'fallback_zoom_url', 'author_email', 'google_calendar_id']) f[k].value = v[k] ?? '';
  $('#blackouts').innerHTML = blk.map((b) => `<li>${esc(b.day)} ${esc(b.note || '')} <a href="#" data-unblock="${b.id}">remove</a></li>`).join('') || '<li class="muted">None</li>';
  $$('[data-unblock]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); await A('blackouts/' + a.dataset.unblock, { method: 'DELETE' }); loadVisits(); }));
}
$('#avail').onsubmit = async (e) => {
  e.preventDefault(); const d = formData(e.currentTarget);
  try {
    const weekly = {};
    for (const line of d.weekly.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const m = line.match(/^(\w{3})\w*\s+(.+)$/); const day = m && DAYS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
      if (!m || day < 0) throw new Error('Line not understood: ' + line);
      weekly[day] = m[2].split(',').map((r) => { const t = r.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/); if (!t) throw new Error('Time range not understood: ' + r); return [t[1].padStart(5, '0'), t[2].padStart(5, '0')]; });
    }
    const value = { ...SETTINGS.visit, weekly, timezone: d.timezone, min_notice_hours: +d.min_notice_hours, window_days: +d.window_days, buffer_min: +d.buffer_min,
      max_per_week: +d.max_per_week, threshold: +d.threshold || 5, fallback_zoom_url: d.fallback_zoom_url, author_email: d.author_email, google_calendar_id: (d.google_calendar_id || '').trim() };
    await A('settings/visit', { method: 'PUT', body: { value } }); SETTINGS.visit = value; say($('#avail-msg'), 'Saved ✓', 'ok');
  } catch (err) { say($('#avail-msg'), err.message); }
};
$('#blackout').onsubmit = async (e) => { e.preventDefault(); await A('blackouts', { method: 'POST', body: formData(e.currentTarget) }); e.currentTarget.reset(); loadVisits(); };

// ---------- templates ----------
async function loadTemplates() {
  const list = await A('templates');
  $('#test-tpl').innerHTML = list.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join('');
  $('#templates').innerHTML = list.map((t) => `<details class="tpl"><summary>${esc(t.label)} ${t.customized ? '<span class="pill ok">customized</span>' : ''}</summary>
    <form data-tpl="${t.key}" style="margin-top:12px"><div class="field"><label>Subject</label><input type="text" name="subject" value="${esc(t.subject)}"></div>
    <div class="field"><label>Body</label><textarea name="body" style="min-height:260px">${esc(t.body)}</textarea></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" type="submit">Save</button>${t.customized ? `<button class="btn sm ghost" type="button" data-reset="${t.key}">Reset to default</button>` : ''}</div><div class="msg"></div></form></details>`).join('');
  $$('[data-tpl]').forEach((f) => (f.onsubmit = async (e) => { e.preventDefault(); await A('templates/' + f.dataset.tpl, { method: 'PUT', body: formData(f) }); say(f.querySelector('.msg'), 'Saved ✓', 'ok'); }));
  $$('[data-reset]').forEach((b) => (b.onclick = async () => { await A('templates/' + b.dataset.reset, { method: 'DELETE' }); loadTemplates(); }));
}
$('#test').onsubmit = async (e) => {
  e.preventDefault(); const b = e.currentTarget.querySelector('button'); busy(b, true, 'Sending…');
  try { const r = await A('test-email', { method: 'POST', body: formData(e.currentTarget) }); alert(r.sent ? 'Test sent ✓' : 'Not sent. Check the outbox for the error.'); } catch (err) { alert(err.message); }
  busy(b, false);
};

// ---------- settings ----------
async function loadSettings() {
  const s = await A('settings'); SETTINGS = s.settings; BOOK = s.books.find((b) => b.is_current) || s.books[0];
  const bf = $('#book-form');
  if (BOOK) { for (const k of ['id', 'title', 'subtitle', 'promise', 'cover_url']) bf[k].value = BOOK[k] || ''; for (const k of ['paperback', 'kindle', 'hardcover']) bf[k].value = BOOK.amazon?.[k] || ''; }
  const a = SETTINGS.activation, af = $('#act-form');
  af.weekday.value = a.rule?.weekdays?.[0] ?? 3; af.nth.value = (a.rule?.nth || [2, 4]).join(','); af.time.value = a.rule?.time || '17:00';
  af.timezone.value = a.timezone; af.default_zoom_url.value = a.default_zoom_url || ''; af.capacity.value = a.capacity || ''; af.enabled.checked = !!a.enabled;
  const sf = $('#site-form'), site = SETTINGS.site;
  for (const k of ['author', 'brand', 'sender_name', 'reply_to', 'updates_list_name']) sf[k].value = site[k] || '';
  sf.testimonials.value = (site.testimonials || []).map((t) => `${t.quote} | ${t.name || ''}`).join('\n');
  sf.volumes.value = (site.volumes || ['Volume One']).join(', ');
  sf.theme_preset.innerHTML = Object.entries(THEMES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
  sf.theme_preset.value = site.theme?.preset || 'brand';
  for (const k of ['accent', 'paper', 'deep', 'ink']) sf['theme_' + k].value = site.theme?.custom?.[k] || '';
  sf.author_photo_url.value = site.author_photo_url || ''; sf.author_bio.value = site.author_bio || '';
  sf.excerpt_title.value = site.excerpt?.title || ''; sf.excerpt_text.value = site.excerpt?.text || ''; sf.excerpt_pdf_url.value = site.excerpt?.pdf_url || '';
  sf.cohort_enabled.checked = !!SETTINGS.cohort.enabled;
}
$('#book-form').onsubmit = async (e) => {
  e.preventDefault(); const d = formData(e.currentTarget);
  const amazon = Object.fromEntries(['paperback', 'kindle', 'hardcover'].filter((k) => d[k]).map((k) => [k, d[k].trim()]));
  try { await A('books', { method: 'POST', body: { id: d.id || undefined, title: d.title, subtitle: d.subtitle, promise: d.promise, cover_url: d.cover_url || null, amazon, is_current: true, ...(d.id ? {} : { slug: 'volume-' + Date.now(), volume: 1 }) } }); say($('#book-msg'), 'Saved ✓ (live on the site within a minute)', 'ok'); }
  catch (err) { say($('#book-msg'), err.message); }
};
$('#act-form').onsubmit = async (e) => {
  e.preventDefault(); const d = formData(e.currentTarget);
  const value = { ...SETTINGS.activation, enabled: d.enabled, timezone: d.timezone, default_zoom_url: d.default_zoom_url, capacity: d.capacity ? +d.capacity : null,
    rule: { weekdays: [+d.weekday], nth: d.nth.split(',').map((n) => +n.trim()).filter((n) => n), time: d.time } };
  try { await A('settings/activation', { method: 'PUT', body: { value } }); SETTINGS.activation = value; say($('#act-msg'), 'Saved ✓ New dates appear within 5 minutes. Existing dates are kept; cancel any you no longer want on the Activation tab.', 'ok'); }
  catch (err) { say($('#act-msg'), err.message); }
};
$('#site-form').onsubmit = async (e) => {
  e.preventDefault(); const d = formData(e.currentTarget);
  const testimonials = d.testimonials.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [quote, name] = l.split('|').map((x) => x.trim()); return { quote, name }; });
  try {
    const hex = (v) => (/^#[0-9a-f]{3,8}$/i.test((v || '').trim()) ? v.trim() : undefined);
    const custom = Object.fromEntries(['accent', 'paper', 'deep', 'ink'].map((k) => [k, hex(d['theme_' + k])]).filter(([, v]) => v));
    const volumes = d.volumes.split(',').map((v) => v.trim()).filter(Boolean);
    const value = { ...SETTINGS.site, author: d.author, brand: d.brand, sender_name: d.sender_name, reply_to: d.reply_to, updates_list_name: d.updates_list_name, testimonials,
      volumes: volumes.length ? volumes : ['Volume One'], theme: { preset: d.theme_preset, custom },
      author_photo_url: d.author_photo_url.trim(), author_bio: d.author_bio.trim(),
      excerpt: { title: d.excerpt_title.trim(), text: d.excerpt_text.trim(), pdf_url: d.excerpt_pdf_url.trim() } };
    await A('settings/site', { method: 'PUT', body: { value } }); SETTINGS.site = value;
    await A('settings/cohort', { method: 'PUT', body: { value: { ...SETTINGS.cohort, enabled: d.cohort_enabled } } });
    say($('#site-msg'), 'Saved ✓', 'ok');
  } catch (err) { say($('#site-msg'), err.message); }
};

// ---------- data ----------
$('#exports').innerHTML = [['contacts', 'All contacts'], ['optins', 'Opted-in subscribers'], ['members', 'Group members'], ['enrollments', 'Cohort enrollments'], ['activation', 'Activation registrations']]
  .map(([k, l]) => `<button class="btn sm ghost" type="button" data-exp="${k}">${l} (CSV)</button>`).join('');
$$('[data-exp]').forEach((b) => (b.onclick = async () => {
  const blob = await A(`export/${b.dataset.exp}.csv`);
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${b.dataset.exp}-${new Date().toISOString().slice(0, 10)}.csv` }); a.click();
}));
$('#ob-status').onchange = loadOutbox;
$('#ob-run').onclick = async () => { const r = await A('outbox/run', { method: 'POST', body: {} }); alert(`Sent ${r.sent}, failed ${r.failed}.`); loadOutbox(); };
async function loadOutbox() {
  const st = $('#ob-status').value;
  const rows = await A('outbox' + (st ? '?status=' + st : ''));
  $('#outbox').innerHTML = '<thead><tr><th>To</th><th>Email</th><th>Send at</th><th>Status</th><th></th></tr></thead><tbody>' + rows.map((r) => `
    <tr><td class="small">${esc(r.to_email)}</td><td class="small">${esc(r.template)}</td><td class="small">${esc(when(r.send_at))}</td>
    <td class="small">${esc(r.status)}${r.last_error ? `<div class="muted">${esc(r.last_error)}</div>` : ''}</td>
    <td>${['failed', 'skipped', 'cancelled'].includes(r.status) ? btn('Retry', `data-retry="${r.id}"`) : ''}</td></tr>`).join('') + '</tbody>';
  $$('[data-retry]').forEach((b) => (b.onclick = async () => { await A(`outbox/${b.dataset.retry}/retry`, { method: 'POST', body: {} }); loadOutbox(); }));
}

if (KEY && !DEMO) start().catch(logout);
