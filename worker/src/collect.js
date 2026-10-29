/* POST /api/collect — first-party, cookie-free analytics beacon.
   Stores one anonymous event: no IP address, no cookies, no form content.
   Dropped silently: bots, other origins, malformed payloads, signed-in admins, floods. */

import { noContent, readBody, sameOrigin } from "./lib/http.js";
import { clean, isBot, deviceOf, refHost } from "./lib/text.js";
import { visitorHash } from "./lib/store.js";
import { currentAdmin } from "./auth.js";

const TYPES = new Set(["pageview", "section_view", "click", "form_start"]);
const SECTIONS = new Set(["hero", "story", "mantra", "sound", "studio", "gallery", "contact"]);
const CLICKS = new Set(["spotify", "apple_music", "youtube", "shazam", "instagram", "email", "book_session"]);

/* Per-isolate flood guard: at most 120 events a minute from one tab session. */
const recent = new Map();
function flooded(key) {
  const minute = Math.floor(Date.now() / 60000);
  const entry = recent.get(key);
  if (!entry || entry.minute !== minute) {
    if (recent.size > 5000) recent.clear();
    recent.set(key, { minute, n: 1 });
    return false;
  }
  entry.n += 1;
  return entry.n > 120;
}

export function parseEvent(data) {
  const type = clean(data.type, 20);
  if (!TYPES.has(type)) return null;
  let name = clean(data.name, 40) || null;
  if (type === "section_view" && !SECTIONS.has(name)) return null;
  if (type === "click" && !CLICKS.has(name)) return null;
  if (type === "pageview" || type === "form_start") name = null;
  let path = clean(data.path, 200) || "/";
  if (!path.startsWith("/") || path.startsWith("//")) path = "/";
  return {
    type,
    name,
    path: path.split("?")[0].split("#")[0] || "/",
    ref: clean(data.ref, 500),
    utm_source: clean(data.utm_source, 100) || null,
    utm_medium: clean(data.utm_medium, 100) || null,
    utm_campaign: clean(data.utm_campaign, 100) || null,
    sid: clean(data.sid, 64).replace(/[^A-Za-z0-9_-]/g, "") || null,
    w: Math.max(0, Math.min(10000, Number(data.w) || 0)),
  };
}

export async function handleCollect(request, env) {
  const url = new URL(request.url);
  if (!sameOrigin(request, [url.origin])) return noContent();
  const ua = request.headers.get("User-Agent") || "";
  if (isBot(ua)) return noContent();
  if (await currentAdmin(request, env)) return noContent(); // dashboard users are not visitors

  const body = await readBody(request, 4000);
  if (!body.data || typeof body.data !== "object") return noContent();
  const ev = parseEvent(body.data);
  if (!ev) return noContent();

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const now = new Date();
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const visitor = await visitorHash(env, day, ip, ua, url.hostname);
  if (flooded(ev.sid || visitor)) return noContent();

  await env.DB.prepare(
    `INSERT INTO events (ts, day, type, name, path, visitor, session, ref_host, utm_source, utm_medium, utm_campaign, device, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    iso, day, ev.type, ev.name, ev.path, visitor, ev.sid || visitor,
    ev.type === "pageview" ? refHost(ev.ref, [url.hostname]) : null,
    ev.utm_source, ev.utm_medium, ev.utm_campaign,
    deviceOf(ua, ev.w), (request.cf && request.cf.country && request.cf.country !== "T1" ? request.cf.country : null)
  ).run();
  return noContent();
}
