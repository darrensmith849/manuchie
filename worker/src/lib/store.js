/* Server-side secrets kept in D1, plus sliding-window rate limiting.
   The session pepper is generated on first use; analytics salts are generated per day
   and deleted after two days, so old visitor hashes can never be recomputed. */

import { hmacHex, randomToken } from "./crypto.js";

const cache = new Map();

async function secret(env, key) {
  if (cache.has(key)) return cache.get(key);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value, created_at) VALUES (?, ?, ?)")
    .bind(key, randomToken(32), now).run();
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  cache.set(key, row.value);
  return row.value;
}

export const pepper = (env) => secret(env, "session_pepper");
export const dailySalt = (env, day) => secret(env, "salt:" + day);

/* Salted IP hash. `scope` separates uses (rate limits rotate daily; consent proof does not). */
export async function ipHash(env, ip, scope) {
  if (!ip) return null;
  return (await hmacHex(await pepper(env), scope + "|" + ip)).slice(0, 32);
}

/* Anonymous visitor id for analytics: changes every day, can't be linked across days. */
export async function visitorHash(env, day, ip, ua, host) {
  return (await hmacHex(await dailySalt(env, day), [ip, ua, host].join("|"))).slice(0, 24);
}

/* Returns true when `bucket` already has `limit` hits inside `windowMs`; otherwise records one. */
export async function rateLimited(env, bucket, limit, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = ? AND ts > ?")
    .bind(bucket, now - windowMs).first();
  if (row.n >= limit) return true;
  await env.DB.prepare("INSERT INTO rate_limits (bucket, ts) VALUES (?, ?)").bind(bucket, now).run();
  return false;
}

/* Counts hits without recording one (used to check login failures before verifying). */
export async function hits(env, bucket, windowMs) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = ? AND ts > ?")
    .bind(bucket, Date.now() - windowMs).first();
  return row.n;
}

export const recordHit = (env, bucket) =>
  env.DB.prepare("INSERT INTO rate_limits (bucket, ts) VALUES (?, ?)").bind(bucket, Date.now()).run();

/* Housekeeping also rides along on ordinary traffic, so it happens even without the cron
   trigger: at most once every 6 hours across the whole site (checked once an hour per isolate). */
let lastCheck = 0;
export async function maybePurge(env) {
  if (Date.now() - lastCheck < 3600000) return;
  lastCheck = Date.now();
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_purge'").first();
  if (row && Date.now() - Number(row.value) < 6 * 3600000) return;
  await env.DB.prepare("INSERT INTO settings (key, value, created_at) VALUES ('last_purge', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(String(Date.now()), new Date().toISOString()).run();
  await purge(env);
}

/* Daily housekeeping (cron, or maybePurge). */
export async function purge(env, now = new Date()) {
  const iso = now.toISOString();
  const keepSaltsFrom = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const eventsBefore = new Date(now.getTime() - 396 * 86400000).toISOString().slice(0, 10); // ~13 months
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(iso),
    env.DB.prepare("DELETE FROM rate_limits WHERE ts < ?").bind(now.getTime() - 2 * 86400000),
    env.DB.prepare("DELETE FROM settings WHERE key LIKE 'salt:%' AND substr(key, 6) < ?").bind(keepSaltsFrom),
    env.DB.prepare("DELETE FROM events WHERE day < ?").bind(eventsBefore),
  ]);
  for (const k of cache.keys()) if (k.startsWith("salt:") && k.slice(5) < keepSaltsFrom) cache.delete(k);
}
