// Tiny Supabase (PostgREST) client over fetch, using the service-role key.
// The key never leaves the server.

export class DbError extends Error {
  constructor(message, status, detail) { super(message); this.status = status; this.detail = detail; }
}

export const eq = (v) => 'eq.' + encodeURIComponent(v);
export const inList = (arr) => 'in.(' + arr.map((v) => '"' + String(v).replace(/"/g, '') + '"').join(',') + ')';

export function db(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase is not configured');
  const base = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  async function req(method, path, body, prefer) {
    const headers = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
    if (prefer) headers.prefer = prefer;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) throw new DbError((data && data.message) || r.statusText, r.status, data);
    return data;
  }

  return {
    select: (table, query = '') => req('GET', `/${table}?${query}`),
    one: async (table, query = '') => (await req('GET', `/${table}?${query}&limit=1`))[0] || null,
    insert: (table, rows, { ignoreDuplicates = false, upsert = false, onConflict } = {}) =>
      req('POST', `/${table}${onConflict ? '?on_conflict=' + onConflict : ''}`, rows,
        ['return=representation', ignoreDuplicates ? 'resolution=ignore-duplicates' : upsert ? 'resolution=merge-duplicates' : '']
          .filter(Boolean).join(',')),
    update: (table, query, patch) => req('PATCH', `/${table}?${query}`, patch, 'return=representation'),
    remove: (table, query) => req('DELETE', `/${table}?${query}`, undefined, 'return=representation'),
    rpc: (fn, args = {}) => req('POST', `/rpc/${fn}`, args),
  };
}

// ---- settings with safe defaults (admin edits these in the dashboard) ----
export const DEFAULT_SETTINGS = {
  site: { author: 'Imani Green', brand: 'The Bloom Project', sender_name: 'Imani Green', reply_to: '', updates_list_name: 'The Bloom Project updates', social: {}, testimonials: [] },
  activation: { enabled: true, rule: { weekdays: [3], nth: [2, 4], time: '17:00' }, timezone: 'America/Los_Angeles', duration_min: 45, default_zoom_url: '', capacity: null, generate_months: 3, next_steps_delay_min: 60 },
  cohort: { enabled: true, waitlist_message: 'Enrollment is closed right now. Join the waitlist and you will be first to know when the next cohort opens.' },
  visit: { threshold: 5, duration_min: 30, timezone: 'America/Los_Angeles', weekly: {}, buffer_min: 15, min_notice_hours: 48, window_days: 60, max_per_week: 3, fallback_zoom_url: '', author_email: '' },
  email: { daily_limit: 95, from: '' },
};

export async function getSettings(client) {
  const rows = await client.select('settings', 'select=key,value');
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows || []) out[r.key] = { ...(out[r.key] || {}), ...r.value };
  return out;
}

export async function currentBook(client) {
  return client.one('books', 'select=*&is_current=is.true');
}
