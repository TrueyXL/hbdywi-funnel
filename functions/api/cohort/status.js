// GET /api/cohort/status?session_id=cs_... — success page polls until the webhook marks it paid.
import { db, eq } from '../../_lib/db.js';
import { json, fail } from '../../_lib/util.js';

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('session_id') || '';
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return fail('bad session');
  const e = await db(env).one('cohort_enrollments', `select=status,cohorts(name,starts_at,timezone)&stripe_session_id=${eq(id)}`);
  if (!e) return fail('not found', 404);
  return json({ status: e.status, cohort: e.cohorts });
}
