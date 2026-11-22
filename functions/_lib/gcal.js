// Google Calendar free/busy for author-visit availability.
//
// Imani blocks out time in her own Google Calendar; any busy time there removes
// booking slots here. Only free/busy is read (never event titles or details).
//
// Setup (one time, free):
//   1. Google Cloud console → new project → enable "Google Calendar API".
//   2. IAM → Service accounts → create one → Keys → Add key → JSON.
//   3. Cloudflare Pages secrets:  GOOGLE_SA_EMAIL = client_email
//                                 GOOGLE_SA_KEY   = private_key (the whole PEM, \n escapes are fine)
//   4. Imani: Google Calendar → Settings → her calendar → "Share with specific people"
//      → add the service-account email with "See only free/busy (hide details)".
//   5. Admin → Author visits → Google Calendar ID = her Gmail address (or the calendar's ID).
//      Add more IDs separated by commas to check several calendars.

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

export const gcalEnabled = (env, cfg) => !!(env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_KEY && calendarIds(cfg).length);
export const calendarIds = (cfg) => String(cfg?.google_calendar_id || '').split(',').map((x) => x.trim()).filter((x) => x && !x.includes('{{'));

let cached = { token: null, exp: 0 };

async function accessToken(env) {
  if (cached.token && cached.exp > Date.now() + 60000) return cached.token;
  const pem = env.GOOGLE_SA_KEY.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64urlStr(JSON.stringify({
    iss: env.GOOGLE_SA_EMAIL, scope: 'https://www.googleapis.com/auth/calendar.freebusy',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + b64url(sig) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google auth: ' + (d.error_description || d.error || r.status));
  cached = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return cached.token;
}

/**
 * Busy blocks [{start, end}] between now and `days` ahead.
 * Throws on failure: callers should treat that as "no availability" rather than
 * offering times that might clash with Imani's real calendar.
 */
export async function calendarBusy(env, cfg, now = new Date(), days = 60) {
  if (!gcalEnabled(env, cfg)) return [];
  const token = await accessToken(env);
  const timeMin = now.toISOString(), timeMax = new Date(now.getTime() + (days + 2) * 86400000).toISOString();
  const r = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, items: calendarIds(cfg).map((id) => ({ id })) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google freeBusy: ' + (d.error?.message || r.status));
  const out = [];
  for (const [id, c] of Object.entries(d.calendars || {})) {
    if (c.errors?.length) throw new Error(`Google calendar ${id}: ${c.errors[0].reason}`); // e.g. notFound = not shared yet
    for (const b of c.busy || []) out.push({ start: b.start, end: b.end });
  }
  return out;
}
