// Shared browser helpers.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const viewerTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
export const params = new URLSearchParams(location.search);

export function fmt(iso, tz = viewerTz(), opts = {}) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...opts }).format(new Date(iso));
}
export const fmtDate = (iso, tz) => fmt(iso, tz, { hour: undefined, minute: undefined, weekday: 'long', month: 'long' });
export const fmtTime = (iso, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const tzName = (tz, iso = new Date()) => new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value || tz;
export const money = (cents, cur = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function formData(form) {
  const d = Object.fromEntries(new FormData(form));
  for (const el of form.querySelectorAll('input[type=checkbox]')) d[el.name] = el.checked;
  return d;
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.setAttribute('aria-busy', 'true'); if (label) btn.textContent = label; }
  else { btn.removeAttribute('aria-busy'); if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}

export function say(el, text, kind = 'err') {
  if (!el) return;
  el.className = 'msg ' + kind;
  el.textContent = text || '';
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
}

// anonymous first-party visitor id (no third-party cookies)
export function vid() {
  try {
    let v = localStorage.getItem('hb_vid');
    if (!v) { v = crypto.randomUUID(); localStorage.setItem('hb_vid', v); }
    return v;
  } catch { return ''; }
}
export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export function header() {
  const top = $('.top');
  if (top) addEventListener('scroll', () => top.classList.toggle('scrolled', scrollY > 8), { passive: true });
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { threshold: .12 }) : null;
  $$('.reveal').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));
}

export const BLOOM_SVG = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 29V15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M16 21c-4 0-6.5-2.4-7-6 3.6.2 6.4 2.4 7 6Zm0-3c4 0 6.5-2.4 7-6-3.6.2-6.4 2.4-7 6Z" fill="currentColor" opacity=".55"/><path d="M16 14c-2.6-1.8-3.4-5-2-8.5 1.2.6 2 1.4 2 1.4s.8-.8 2-1.4c1.4 3.5.6 6.7-2 8.5Z" fill="currentColor"/></svg>';
