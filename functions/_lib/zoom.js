// Zoom Server-to-Server OAuth (free with Imani's paid Zoom account).
// If ZOOM_* vars are absent, callers fall back to a fixed Zoom link from settings.

let cached = { token: null, exp: 0 };

export const zoomEnabled = (env) => !!(env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET);

async function token(env) {
  if (cached.token && cached.exp > Date.now() + 60000) return cached.token;
  const r = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${env.ZOOM_ACCOUNT_ID}`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`) },
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Zoom auth: ' + (d.reason || d.error || r.status));
  cached = { token: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return cached.token;
}

async function call(env, method, path, body) {
  const r = await fetch('https://api.zoom.us/v2' + path, {
    method,
    headers: { authorization: 'Bearer ' + (await token(env)), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error('Zoom: ' + (d?.message || r.status));
  return d;
}

export function createMeeting(env, { topic, startIso, minutes, tz }) {
  return call(env, 'POST', `/users/${env.ZOOM_USER || 'me'}/meetings`, {
    topic, type: 2, start_time: startIso, duration: minutes, timezone: tz,
    settings: { join_before_host: false, waiting_room: true, mute_upon_entry: true },
  });
}
export const updateMeeting = (env, id, { startIso, minutes, tz }) =>
  call(env, 'PATCH', `/meetings/${id}`, { start_time: startIso, duration: minutes, timezone: tz });
export const deleteMeeting = (env, id) => call(env, 'DELETE', `/meetings/${id}`);
