/* Dashboard authentication: password login, session cookies, CSRF.
   - Passwords: PBKDF2-SHA256 (lib/crypto.js). Admins are created only by scripts/create-admin.mjs.
   - Session cookie: __Host- prefixed, HttpOnly, Secure, SameSite=Strict, 12-hour absolute expiry.
     Only the SHA-256 hash of the token is stored, so a database leak can't be replayed.
   - Every state-changing call needs a same-origin Origin header AND the session's CSRF token. */

import { json, getCookie, readBody, sameOrigin } from "./lib/http.js";
import { sha256Hex, randomToken, verifyPassword, dummyVerify, safeEqual, hashPassword } from "./lib/crypto.js";
import { clean, normEmail } from "./lib/text.js";
import { ipHash, hits, recordHit } from "./lib/store.js";

export const COOKIE = "__Host-mz_admin";
const SESSION_MS = 12 * 3600 * 1000;
const FAIL_WINDOW = 15 * 60000;
const MAX_FAILS_IP = 10;
const MAX_FAILS_ACCOUNT = 5;
export const MIN_PASSWORD = 12;

const sessionCookie = (token, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

const resolved = new WeakMap();

/* The signed-in admin for this request, or null. Cached per request. */
export async function currentAdmin(request, env) {
  if (resolved.has(request)) return resolved.get(request);
  let result = null;
  const token = getCookie(request, COOKIE);
  if (token && /^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    const row = await env.DB.prepare(
      `SELECT s.id AS sid, s.csrf, s.last_seen_at, a.id, a.email FROM sessions s
       JOIN admins a ON a.id = s.admin_id WHERE s.id = ? AND s.expires_at > ?`
    ).bind(await sha256Hex(token), new Date().toISOString()).first();
    if (row) {
      result = { id: row.id, email: row.email, sessionId: row.sid, csrf: row.csrf };
      if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60000) {
        await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(new Date().toISOString(), row.sid).run();
      }
    }
  }
  resolved.set(request, result);
  return result;
}

/* Gate for /api/admin/*: returns { admin } or { response } to send back as-is. */
export async function requireAdmin(request, env) {
  const admin = await currentAdmin(request, env);
  if (!admin) return { response: json({ ok: false, error: "unauthorised" }, 401) };
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = new URL(request.url).origin;
    if (!sameOrigin(request, [origin])) return { response: json({ ok: false, error: "origin" }, 403) };
    if (!safeEqual(request.headers.get("X-CSRF-Token") || "", admin.csrf)) {
      return { response: json({ ok: false, error: "csrf" }, 403) };
    }
  }
  return { admin };
}

export async function handleLogin(request, env) {
  const url = new URL(request.url);
  if (!sameOrigin(request, [url.origin])) return json({ ok: false, error: "origin" }, 403);
  const body = await readBody(request, 4000);
  const email = normEmail(clean(body.data && body.data.email, 254));
  const password = body.data && typeof body.data.password === "string" ? body.data.password.slice(0, 200) : "";
  if (!email || !password) return json({ ok: false, error: "invalid" }, 400);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipBucket = "loginip:" + (await ipHash(env, ip, "login"));
  const acctBucket = "loginacct:" + (await sha256Hex(email)).slice(0, 32);
  if ((await hits(env, ipBucket, FAIL_WINDOW)) >= MAX_FAILS_IP || (await hits(env, acctBucket, FAIL_WINDOW)) >= MAX_FAILS_ACCOUNT) {
    return json({ ok: false, error: "rate_limited", retry_after: 900 }, 429);
  }

  const admin = await env.DB.prepare("SELECT id, email, password_hash FROM admins WHERE email = ?").bind(email).first();
  const good = admin ? await verifyPassword(password, admin.password_hash) : await dummyVerify(password);
  if (!good) {
    await recordHit(env, ipBucket);
    await recordHit(env, acctBucket);
    return json({ ok: false, error: "invalid" }, 401);
  }

  const token = randomToken(32);
  const now = new Date();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO sessions (id, admin_id, csrf, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(await sha256Hex(token), admin.id, randomToken(24), now.toISOString(),
      new Date(now.getTime() + SESSION_MS).toISOString(), now.toISOString(), clean(request.headers.get("User-Agent"), 300)),
    env.DB.prepare("UPDATE admins SET last_login_at = ? WHERE id = ?").bind(now.toISOString(), admin.id),
  ]);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, SESSION_MS / 1000) });
}

export async function handleLogout(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.admin) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(gate.admin.sessionId).run();
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

export async function changePassword(env, admin, current, next) {
  const row = await env.DB.prepare("SELECT password_hash FROM admins WHERE id = ?").bind(admin.id).first();
  if (!row || !(await verifyPassword(String(current || "").slice(0, 200), row.password_hash))) {
    return { ok: false, error: "current", message: "Your current password is not correct." };
  }
  const pw = String(next || "");
  if (pw.length < MIN_PASSWORD || pw.length > 200) {
    return { ok: false, error: "weak", message: `Use at least ${MIN_PASSWORD} characters.` };
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?").bind(await hashPassword(pw), now, admin.id),
    env.DB.prepare("DELETE FROM sessions WHERE admin_id = ? AND id != ?").bind(admin.id, admin.sessionId),
  ]);
  return { ok: true };
}
