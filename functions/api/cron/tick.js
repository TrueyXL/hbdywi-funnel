// POST /api/cron/tick (Authorization: Bearer CRON_SECRET)
// Called every 5 minutes by cron-worker/. Also keeps the Supabase free project awake.
import { db, getSettings } from '../../_lib/db.js';
import { json, fail, timingSafeEqual } from '../../_lib/util.js';
import { activationDates } from '../../_lib/time.js';
import { processOutbox } from '../../_lib/outbox.js';

export async function onRequestPost({ request, env }) {
  const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.CRON_SECRET || !timingSafeEqual(auth, env.CRON_SECRET)) return fail('unauthorized', 401);
  const client = db(env);
  const settings = await getSettings(client);
  const now = new Date();
  const out = {};

  // 1) keep N months of activation sessions on the calendar (unique starts_at → idempotent;
  //    sessions the admin cancelled stay cancelled and are not recreated)
  if (settings.activation.enabled && settings.activation.rule) {
    const dates = activationDates(settings.activation.rule, settings.activation.timezone, now, settings.activation.generate_months || 3);
    if (dates.length) {
      const rows = await client.insert('activation_sessions', dates.map((d) => ({
        starts_at: d.toISOString(), duration_min: settings.activation.duration_min || 45, capacity: settings.activation.capacity ?? null, auto_created: true,
      })), { ignoreDuplicates: true, onConflict: 'starts_at' });
      out.sessions_created = rows?.length || 0;
    }
  }

  // 2) housekeeping
  const iso = now.toISOString();
  await client.update('activation_sessions', `status=eq.scheduled&starts_at=lt.${new Date(now - 45 * 60000).toISOString()}`, { status: 'completed' });
  await client.update('author_visits', `status=eq.booked&starts_at=lt.${new Date(now - 30 * 60000).toISOString()}`, { status: 'completed', updated_at: iso });
  await client.update('cohort_enrollments', `status=eq.pending&created_at=lt.${new Date(now - 35 * 60000).toISOString()}`, { status: 'expired', updated_at: iso });
  await client.update('cohorts', `status=eq.closed&ends_at=lt.${iso}`, { status: 'completed' });
  await client.update('cohorts', `status=eq.open&ends_at=lt.${iso}`, { status: 'completed' });

  // 3) send what's due
  out.email = env.RESEND_API_KEY ? await processOutbox(env, client, { limit: Number(env.CRON_BATCH || 15) }) : 'resend not configured';
  return json({ ok: true, at: iso, ...out });
}
