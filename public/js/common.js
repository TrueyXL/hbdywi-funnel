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

// ---------------------------------------------------------------- seasonal themes
// The look is driven by a few colour tokens. Admin → Site → Theme picks a preset
// (or "brand" with custom colours), and every page applies it on load. The last
// theme is cached so returning visitors don't see a flash of the default colours.
export const THEMES = {
  brand:  { label: 'Brand (default)', paper: '#f6f1ea', paper2: '#efe6da', card: '#fffdf9', ink: '#23201c', ink2: '#5a524a', line: '#e2d8cb', deep: '#2f3a2f', accent: '#b4566e', soft: '#f3dfe3', gold: '#c9a45c', accentDark: '#e08ea2' },
  winter: { label: 'Winter', paper: '#eef2f6', paper2: '#e2e9f0', card: '#fbfdff', ink: '#1b2230', ink2: '#4c5668', line: '#d3dce7', deep: '#1f2f4a', accent: '#8a2d3b', soft: '#f1dde0', gold: '#b8a46a', accentDark: '#e48a98' },
  spring: { label: 'Spring', paper: '#f5f6ee', paper2: '#e9eedd', card: '#fffffa', ink: '#1f241c', ink2: '#525b49', line: '#dde3cf', deep: '#2f4a32', accent: '#c25a7c', soft: '#f6e0e8', gold: '#c7a94f', accentDark: '#ec97b2' },
  summer: { label: 'Summer', paper: '#fbf5ea', paper2: '#f6e9d2', card: '#fffdf7', ink: '#26201a', ink2: '#5e5246', line: '#ecdcc2', deep: '#1f4b4f', accent: '#d0622f', soft: '#fbe3d5', gold: '#d8a640', accentDark: '#f2935f' },
  autumn: { label: 'Autumn', paper: '#f5eee6', paper2: '#ece0d1', card: '#fffaf4', ink: '#2a1f18', ink2: '#5f4c3e', line: '#e2d2bf', deep: '#4a2e1f', accent: '#a8452a', soft: '#f2ddd2', gold: '#c08a3a', accentDark: '#e2866a' },
};
const TOKEN = { paper: '--paper', paper2: '--paper-2', card: '--card', ink: '--ink', ink2: '--ink-2', line: '--line', deep: '--forest', accent: '--bloom', soft: '--bloom-soft', gold: '--gold' };

/** theme: {preset: 'winter', custom: {accent:'#...', ...}} → injects a <style> overriding the light tokens + dark accent. */
export function applyTheme(theme, { cache = true } = {}) {
  if (!theme) return;
  const base = THEMES[theme.preset] || THEMES.brand;
  const t = { ...base, ...(theme.preset === 'custom' || theme.preset === 'brand' ? theme.custom || {} : {}) };
  const ok = (v) => /^#[0-9a-f]{3,8}$/i.test(v || '');
  const light = Object.entries(TOKEN).filter(([k]) => ok(t[k])).map(([k, v]) => `${v}:${t[k]}`).join(';');
  const dark = ok(t.accentDark) ? `--bloom:${t.accentDark};--focus:${t.accentDark}` : '';
  let el = document.getElementById('theme-tokens');
  if (!el) { el = document.createElement('style'); el.id = 'theme-tokens'; document.head.appendChild(el); }
  el.textContent = `:root{${light};--focus:${t.accent}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}
:root[data-theme="dark"]{${dark}}`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.paper);
  document.documentElement.dataset.season = theme.preset || 'brand';
  if (cache) store.set('hb_theme', theme);
}
applyTheme(store.get('hb_theme'), { cache: false });
