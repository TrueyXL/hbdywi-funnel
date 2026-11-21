// Every 5 minutes: generate sessions, housekeeping, send due reminders, keep Supabase awake.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
  async fetch(_req, env) { // manual trigger for testing: curl https://hbdywi-cron.<you>.workers.dev
    return new Response(JSON.stringify(await tick(env)), { headers: { 'content-type': 'application/json' } });
  },
};
async function tick(env) {
  const r = await fetch(env.SITE_URL.replace(/\/$/, '') + '/api/cron/tick', {
    method: 'POST', headers: { authorization: 'Bearer ' + env.CRON_SECRET },
  });
  const body = await r.text();
  if (!r.ok) console.error('tick failed', r.status, body);
  return { status: r.status, body: body.slice(0, 500) };
}
