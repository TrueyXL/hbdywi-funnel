// /j/:code → short shareable invite link; redirects to the member signup page.
export const onRequestGet = ({ params, request }) =>
  Response.redirect(new URL(`/join?c=${encodeURIComponent(String(params.code).toUpperCase().slice(0, 12))}`, request.url).toString(), 302);
