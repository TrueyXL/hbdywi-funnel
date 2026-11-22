import { $, $$, fmt, fmtDate, fmtTime, tzName, viewerTz, money, esc, formData, busy, say, store, header, applyTheme, BLOOM_SVG } from './common.js';
import { api, track, amazonHref, demoBar, DEMO } from './api.js';

demoBar();
header();
$$('[data-bloom]').forEach((el) => (el.outerHTML = BLOOM_SVG));
$('#yr').textContent = new Date().getFullYear();
track('page_view');

const tz = viewerTz();
let cfg = null;

function bind(key, value) { if (value) $$(`[data-bind="${key}"]`).forEach((el) => (el.textContent = value)); }

async function load() {
  try { cfg = await api('config'); } catch (e) { $('#act-dates').innerHTML = `<p class="msg err">Couldn't load dates. Please refresh.</p>`; return; }
  const { site, book, activation, cohort, visit } = cfg;
  if (site.theme) applyTheme(site.theme);
  bind('brand', site.brand); bind('author', site.author); bind('updates_list_name', site.updates_list_name);
  bind('threshold', visit.threshold);
  if (book) {
    const real = (v) => v && !String(v).includes('{{');
    if (real(book.title)) { bind('title', book.title); document.title = `${book.title} · ${site.author}`; }
    if (real(book.promise)) bind('promise', book.promise);
    bind('subtitle_or_promise', real(book.promise) ? book.promise : null);
    bind('author_line', `${site.author} · Volume One`);
    if (real(book.cover_url)) $$('.cover').forEach((c) => (c.innerHTML = `<img src="${esc(book.cover_url)}" alt="${esc(book.title)} book cover">`));
    const fm = book.formats || [];
    $$('#buy-buttons [data-amazon]').forEach((a) => { if (fm.length && !fm.includes(a.dataset.amazon)) a.remove(); });
  }
  renderAuthor(site); renderExcerpt(site.excerpt);
  const ts = (site.testimonials || []).filter((t) => t.quote);
  if (ts.length) {
    $('#testimonials').innerHTML = ts.map((t) => `<figure class="card quote-card reveal in"><blockquote class="quote">“${esc(t.quote)}”</blockquote><figcaption class="small muted">${esc(t.name || '')}</figcaption></figure>`).join('');
    $('#testimonials-wrap').classList.remove('hidden');
  }
  renderActivation(activation);
  renderCohorts(cohort);
}

// paragraphs from plain text (blank line = new paragraph), escaped
const paras = (txt) => String(txt || '').trim().split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const realUrl = (u) => /^https:\/\//.test(u || '');

function renderAuthor(site) {
  if (realUrl(site.author_photo_url)) $('#author-photo').innerHTML = `<img src="${esc(site.author_photo_url)}" alt="${esc(site.author)}, author" loading="lazy">`;
  if (site.author_bio && !site.author_bio.includes('{{')) $('#author-bio').innerHTML = paras(site.author_bio);
}
function renderExcerpt(x) {
  if (!x) return;
  if (x.title) bind('excerpt_title', x.title);
  if (x.text?.trim()) $('#excerpt-body').innerHTML = paras(x.text);
  if (realUrl(x.pdf_url)) { const a = $('#excerpt-pdf'); a.href = x.pdf_url; a.classList.remove('hidden'); }
}

// ---------------- activation ----------------
function renderActivation(a) {
  $('#act-tz').textContent = `· times in ${tzName(tz)}`;
  const box = $('#act-dates');
  if (!a.enabled || !a.sessions.length) { box.innerHTML = '<p class="muted">New dates are coming soon. Check back shortly.</p>'; return; }
  box.innerHTML = a.sessions.map((s, i) => `
    <label class="chip"><input type="radio" name="session_id" value="${esc(s.id)}" ${s.full ? 'disabled' : ''} ${i === 0 && !s.full ? 'checked' : ''} required>
      <span><b>${esc(fmtDate(s.starts_at, tz).replace(/, \d{4}$/, ''))}</b><small>${esc(fmtTime(s.starts_at, tz))} · ${s.duration_min} min${s.full ? ' · full' : s.seats_left != null && s.seats_left <= 10 ? ` · ${s.seats_left} left` : ''}</small></span></label>`).join('');
}

$('#act-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget, btn = f.querySelector('button[type=submit]'), msg = $('#act-msg');
  const d = formData(f);
  if (!d.session_id) return say(msg, 'Please choose a session date.');
  if (!d.first_name?.trim() || !f.email.checkValidity()) return say(msg, 'Please enter your first name and a valid email.');
  busy(btn, true, 'Reserving…'); say(msg, '');
  try {
    const r = await api('activation/register', { method: 'POST', body: { ...d, tz } });
    const s = cfg.activation.sessions.find((x) => x.id === d.session_id);
    f.innerHTML = `<div class="center stack" role="status"><div style="font-size:2.4rem">🌸</div><h3>${r.already_registered ? "You're already registered!" : "You're in!"}</h3>
      <p>We just emailed your Zoom link and calendar invite to <b>${esc(d.email)}</b>.</p>
      <p class="muted">${esc(fmt(s.starts_at, tz, { weekday: 'long', month: 'long', timeZoneName: 'short' }))}</p>
      <p class="small muted">Don't see it? Check Promotions/Spam, then add us to your contacts.</p>
      <p><a href="#book">While you wait: get Volume One →</a></p></div>`;
  } catch (err) { say(msg, err.message); busy(btn, false); }
});

// ---------------- cohort ----------------
function renderCohorts(c) {
  const list = $('#co-list');
  const open = (c.cohorts || []).filter((x) => x.open);
  if (c.cohorts?.[0]) bind('price', money(c.cohorts[0].price_cents, c.cohorts[0].currency)), bind('price_tag', money(c.cohorts[0].price_cents, c.cohorts[0].currency));
  if (c.cohorts?.[0]?.capacity) bind('cohort_cap', c.cohorts[0].capacity);
  if (!c.enabled || !open.length) {
    $('#co-form').classList.add('hidden'); $('#wl-form').classList.remove('hidden');
    $('#wl-text').textContent = c.waitlist_message; return;
  }
  list.innerHTML = c.cohorts.map((x, i) => `
    <label class="cohort" ${x.open ? '' : 'aria-disabled="true" style="opacity:.6;cursor:not-allowed"'}>
      <input type="radio" name="cohort_id" value="${esc(x.id)}" ${x.open ? '' : 'disabled'} ${x.id === open[0].id ? 'checked' : ''}>
      <span class="meta"><b>${esc(x.name)}</b><span class="small muted">Starts ${esc(fmtDate(x.starts_at, tz))}${x.schedule_text ? ' · ' + esc(x.schedule_text) : ''}</span></span>
      <span class="pill ${x.open ? (x.seats_left <= 5 ? 'warn' : 'ok') : ''}">${x.open ? `${x.seats_left} seats left` : 'Full'}</span>
    </label>`).join('') + `<p class="small muted" style="margin:0">Cohort full? <a href="#" id="to-waitlist">Join the waitlist</a> instead.</p>`;
  $('#to-waitlist').onclick = (e) => { e.preventDefault(); $('#co-form').classList.add('hidden'); $('#wl-form').classList.remove('hidden'); $('#wl-text').textContent = 'We will email you the moment the next cohort opens.'; };
  $('#co-pay').textContent = `Continue to secure checkout · ${money(open[0].price_cents, open[0].currency)}`;
}

$('#co-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget, btn = $('#co-pay'), msg = $('#co-msg');
  const d = formData(f);
  if (!d.cohort_id) return say(msg, 'Please choose a cohort.');
  if (!d.first_name?.trim() || !f.email.checkValidity()) return say(msg, 'Please enter your first name and a valid email.');
  busy(btn, true, 'Opening secure checkout…'); say(msg, '');
  try { const r = await api('cohort/checkout', { method: 'POST', body: d }); location.href = r.url; }
  catch (err) {
    busy(btn, false); say(msg, err.message);
    if (err.data?.waitlist) { $('#co-form').classList.add('hidden'); $('#wl-form').classList.remove('hidden'); }
  }
});

$('#wl-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget, btn = f.querySelector('button'), msg = $('#wl-msg');
  const d = formData(f);
  if (!d.first_name?.trim() || !f.email.checkValidity()) return say(msg, 'Please enter your first name and a valid email.');
  busy(btn, true, 'Adding you…');
  try { await api('cohort/waitlist', { method: 'POST', body: d }); f.innerHTML = `<div class="center stack" role="status"><h3>You're on the list 🌱</h3><p class="muted">We'll email <b>${esc(d.email)}</b> as soon as the next cohort opens.</p></div>`; }
  catch (err) { busy(btn, false); say(msg, err.message); }
});

// ---------------- Amazon: open in new tab, then invite (non-blocking) ----------------
const sheet = $('#amz-sheet');
$$('[data-amazon]').forEach((a) => {
  a.href = amazonHref(a.dataset.amazon, a.dataset.src);
  a.target = '_blank'; a.rel = 'noopener';
  a.addEventListener('click', () => {
    if (DEMO) track('amazon_click');
    store.set('hb_amazon', Date.now());
    setTimeout(() => { sheet.classList.add('open'); sheet.querySelector('.x').focus({ preventScroll: true }); }, 400);
  });
});
$$('[data-close]', sheet).forEach((b) => b.addEventListener('click', () => sheet.classList.remove('open')));
addEventListener('keydown', (e) => e.key === 'Escape' && sheet.classList.remove('open'));
$('#amz-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget, msg = $('#amz-msg'), d = formData(f);
  if (!d.first_name?.trim() || !f.email.checkValidity()) return say(msg, 'Please enter your first name and a valid email.');
  try { await api('interest', { method: 'POST', body: d }); say(msg, 'Sent! Check your inbox.', 'ok'); f.querySelector('button').disabled = true; }
  catch (err) { say(msg, err.message); }
});

// returning visitor who already clicked Amazon → skip the book step
if (store.get('hb_amazon')) $('#welcome-back').classList.remove('hidden');

$$('[data-cta]').forEach((el) => el.addEventListener('click', () => track('cta_click', { cta: el.dataset.cta })));

load();
