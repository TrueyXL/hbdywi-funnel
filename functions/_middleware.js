// Global error handling + security headers for every route.
export async function onRequest(context) {
  try {
    const res = await context.next();
    const h = new Headers(res.headers);
    h.set('x-content-type-options', 'nosniff');
    h.set('referrer-policy', 'strict-origin-when-cross-origin');
    h.set('x-frame-options', 'SAMEORIGIN');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  } catch (e) {
    console.error(context.request.method, new URL(context.request.url).pathname, e.stack || e);
    const msg = /not configured|Missing environment/.test(e.message) ? e.message : 'Something went wrong. Please try again.';
    return new Response(JSON.stringify({ error: 'server_error', message: msg }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
}
