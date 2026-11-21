// POST /api/cohort/checkout {cohort_id, first_name, last_name, email, opt_in} → {url} (Stripe Checkout)
import { db, getSettings, eq } from '../../_lib/db.js';
import { json, fail, readBody, clean, isEmail, bool, isUuid, isBot, siteUrl } from '../../_lib/util.js';
import { createCheckout } from '../../_lib/stripe.js';

export async function onRequestPost({ request, env }) {
  const b = await readBody(request);
  if (isBot(b)) return json({ ok: true });
  const first = clean(b.first_name, 80), last = clean(b.last_name, 80), email = clean(b.email, 254).toLowerCase();
  if (!first || !isEmail(email) || !isUuid(b.cohort_id)) return fail('Please enter your name and a valid email.');
  if (!env.STRIPE_SECRET_KEY) return fail('Payments are not connected yet.', 503);
  const client = db(env);
  const settings = await getSettings(client);
  if (!settings.cohort.enabled) return fail('Enrollment is closed.', 409, { waitlist: true });
  const res = await client.rpc('reserve_cohort_seat', { p_cohort: b.cohort_id, p_email: email, p_first: first, p_last: last, p_opt_in: bool(b.opt_in) });
  if (res.error === 'already_enrolled') return fail("You're already enrolled in this cohort. Check your inbox for your welcome email.", 409);
  if (res.error) return fail('This cohort is full or closed. Join the waitlist and we will tell you when the next one opens.', 409, { waitlist: true });

  const base = siteUrl(env);
  const session = await createCheckout(env, {
    enrollmentId: res.enrollment_id, cohortId: b.cohort_id, cohortName: res.cohort_name, email,
    priceCents: res.price_cents, currency: res.currency,
    successUrl: `${base}/cohort-success?session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${base}/#cohort`,
  });
  await client.update('cohort_enrollments', `id=${eq(res.enrollment_id)}`, { stripe_session_id: session.id });
  return json({ url: session.url });
}
