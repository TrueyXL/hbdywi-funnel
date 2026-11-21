// POST /api/stripe/webhook — configure in Stripe for: checkout.session.completed,
// checkout.session.async_payment_succeeded, checkout.session.expired, charge.refunded
import { db, getSettings, eq } from '../../_lib/db.js';
import { json, fail } from '../../_lib/util.js';
import { verifyWebhook } from '../../_lib/stripe.js';
import { markPaid } from '../../_lib/flows.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const raw = await request.text();
  let event;
  try { event = await verifyWebhook(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET); }
  catch (e) { return fail('invalid signature: ' + e.message, 400); }

  const client = db(env);
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (obj.payment_status !== 'paid') break; // async methods finish later
      const enrollmentId = obj.metadata?.enrollment_id || obj.client_reference_id;
      if (!enrollmentId) break;
      await markPaid(context, client, { enrollmentId, sessionId: obj.id, paymentIntent: obj.payment_intent, amount: obj.amount_total, settings: await getSettings(client) });
      break;
    }
    case 'checkout.session.expired': {
      const id = obj.metadata?.enrollment_id;
      if (id) await client.update('cohort_enrollments', `id=${eq(id)}&status=eq.pending`, { status: 'expired' });
      break;
    }
    case 'charge.refunded': {
      if (obj.payment_intent && obj.refunded) {
        await client.update('cohort_enrollments', `stripe_payment_intent=${eq(obj.payment_intent)}`, { status: 'refunded', updated_at: new Date().toISOString() });
        // pending reminders are skipped automatically (claim_outbox checks status = paid)
      }
      break;
    }
  }
  return json({ received: true });
}
