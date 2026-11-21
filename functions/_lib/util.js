// Shared helpers for Cloudflare Pages Functions. No npm dependencies.

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const fail = (error, status = 400, extra = {}) => json({ error, ...extra }, status);

export async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  try {
    if (type.includes('application/json')) return await request.json();
    if (type.includes('form')) return Object.fromEntries(await request.formData());
    const t = await request.text();
    return t ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}

export const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
export const bool = (v) => v === true || v === 'true' || v === 'on' || v === 'yes' || v === '1';
export const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
export const isTz = (tz) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return !!tz; } catch { return false; }
};

export const siteUrl = (env) => (env.SITE_URL || 'http://localhost:8788').replace(/\/$/, '');

// Honeypot + minimal abuse guard for public forms
export function isBot(body) {
  return !!(body && (body.website || body.company_url)); // hidden fields humans never fill
}

export function timingSafeEqual(a = '', b = '') {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function requireEnv(env, keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new Error('Missing environment variables: ' + missing.join(', '));
}
