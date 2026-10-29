/* Response helpers and the security headers every Worker-generated response carries. */

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/* API and dashboard responses: never cached, never indexed, never framed. */
export const PRIVATE_HEADERS = {
  ...BASE_HEADERS,
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export const DASHBOARD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...PRIVATE_HEADERS, "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export const noContent = (headers = {}) => new Response(null, { status: 204, headers: { ...PRIVATE_HEADERS, ...headers } });

export function text(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8", ...headers } });
}

export function redirect(location, status = 302, headers = {}) {
  return new Response(null, { status, headers: { ...PRIVATE_HEADERS, Location: location, ...headers } });
}

export function csv(filename, body) {
  return new Response(body, {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/* Copy a response (e.g. from the asset store) and lay private headers over it. */
export function withHeaders(res, headers) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* Same-origin check for state-changing requests. Browsers always send Origin on
   POST/PATCH/DELETE; when it is missing we fall back to the Referer. */
export function sameOrigin(request, allowed) {
  const origin = request.headers.get("Origin");
  if (origin) return allowed.includes(origin);
  const ref = request.headers.get("Referer");
  if (!ref) return false;
  try { return allowed.includes(new URL(ref).origin); } catch { return false; }
}

export async function readBody(request, limit = 20000) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > limit) return { tooLarge: true };
  const raw = await request.text();
  if (raw.length > limit) return { tooLarge: true };
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (type.includes("application/x-www-form-urlencoded")) {
    return { form: true, data: Object.fromEntries(new URLSearchParams(raw)) };
  }
  try { return { data: raw ? JSON.parse(raw) : {} }; } catch { return { invalid: true }; }
}

export function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
