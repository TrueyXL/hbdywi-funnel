// Stripe Checkout + webhook verification without the SDK.

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(env, method, path, params) {
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' },
    body: params ? form(params) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Stripe: ' + (data.error?.message || r.statusText));
  return data;
}

export function createCheckout(env, { enrollmentId, cohortId, cohortName, email, priceCents, currency, successUrl, cancelUrl }) {
  return stripe(env, 'POST', '/checkout/sessions', {
    mode: 'payment',
    customer_email: email,
    client_reference_id: enrollmentId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // seat is held 35 min in the DB
    payment_intent_data: { receipt_email: email, metadata: { enrollment_id: enrollmentId, cohort_id: cohortId } },
    metadata: { enrollment_id: enrollmentId, cohort_id: cohortId },
    line_items: { 0: { quantity: 1, price_data: { currency, unit_amount: priceCents, product_data: { name: `Guided Cohort — ${cohortName}`, description: 'Live guided cohort. The book is purchased separately on Amazon.' } } } },
  });
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Verifies the Stripe-Signature header. Returns the parsed event or throws. */
export async function verifyWebhook(rawBody, header, secret, toleranceSec = 300) {
  if (!header) throw new Error('missing signature');
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new Error('timestamp outside tolerance');
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  if (!sigs.includes(expected)) throw new Error('bad signature');
  return JSON.parse(rawBody);
}
