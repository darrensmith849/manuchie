/* POST /api/enquiry — the website's contact form.
   JSON from the page's script, or a plain form post when JavaScript is off.
   Validates, rate-limits, flags spam, stores the enquiry (plus contact and consent proof),
   then emails it to Manuchie in the background. */

import { json, escapeHtml, readBody, sameOrigin, PRIVATE_HEADERS } from "./lib/http.js";
import { clean, isEmail, normEmail, truthy, stripUrl, refHost, linkCount } from "./lib/text.js";
import { newId, randomToken } from "./lib/crypto.js";
import { ipHash, visitorHash, rateLimited } from "./lib/store.js";
import { deliverEnquiry } from "./email.js";

/* Must match the checkbox label on the page exactly: it is stored as proof of consent. */
export const CONSENT_WORDING =
  "Keep me posted about new music and projects from Manuchie. Optional — you can unsubscribe at any time.";

const LIMITS = { name: 120, email: 254, message: 5000 };
const MIN_FILL_MS = 3000;

export function validateEnquiry(raw) {
  const v = {
    name: clean(raw.name, LIMITS.name),
    email: clean(raw.email, LIMITS.email),
    message: clean(raw.message, LIMITS.message, { multiline: true }),
    marketing_consent: truthy(raw.marketing_consent),
    botcheck: truthy(raw.botcheck),
    started_at: Number(raw.started_at) || null,
    source_page: clean(raw.source_page, 200) || "/",
    referrer: stripUrl(raw.referrer),
    utm_source: clean(raw.utm_source, 100) || null,
    utm_medium: clean(raw.utm_medium, 100) || null,
    utm_campaign: clean(raw.utm_campaign, 100) || null,
    sid: clean(raw.sid, 64) || null,
  };
  if (!v.source_page.startsWith("/")) v.source_page = "/";
  const fields = {};
  if (!v.name) fields.name = "Please enter your name.";
  if (!v.email) fields.email = "Please enter your email address.";
  else if (!isEmail(v.email)) fields.email = "Please enter a valid email address.";
  if (!v.message) fields.message = "Please tell us a little about the project.";
  if (String(raw.message || "").length > LIMITS.message + 500) fields.message = "Please keep the message under 5,000 characters.";
  return { value: v, fields, ok: Object.keys(fields).length === 0 };
}

export function spamReason(v, now = Date.now()) {
  if (v.botcheck) return "honeypot";
  if (v.started_at && now - v.started_at < MIN_FILL_MS && now - v.started_at > -60000) return "too_fast";
  if (linkCount(v.message) > 3) return "links";
  return null;
}

export async function handleEnquiry(request, env, ctx) {
  const url = new URL(request.url);
  const body = await readBody(request);
  const asForm = Boolean(body.form);
  const reply = (status, data) => (asForm ? confirmationPage(status, data) : json(data, status));

  if (!sameOrigin(request, [url.origin])) return reply(403, { ok: false, error: "origin" });
  if (body.tooLarge) return reply(413, { ok: false, error: "validation", fields: { message: "Please keep the message under 5,000 characters." } });
  if (body.invalid) return reply(400, { ok: false, error: "validation", fields: {} });

  const { value: v, fields, ok } = validateEnquiry(body.data || {});
  if (!ok) return reply(400, { ok: false, error: "validation", fields });

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const now = new Date();
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const rlKey = await ipHash(env, ip || "unknown", "rl:" + day);
  if ((await rateLimited(env, "enq10m:" + rlKey, 5, 10 * 60000)) || (await rateLimited(env, "enq1d:" + rlKey, 20, 86400000))) {
    return reply(429, { ok: false, error: "rate_limited", retry_after: 600 });
  }

  const spam = spamReason(v, now.getTime());
  const id = newId();
  const ua = clean(request.headers.get("User-Agent"), 300);
  const stmts = [];
  let contactId = null;

  if (!spam) {
    const emailNorm = normEmail(v.email);
    const existing = await env.DB.prepare("SELECT id FROM contacts WHERE email_norm = ?").bind(emailNorm).first();
    contactId = existing ? existing.id : newId();
    if (existing) {
      stmts.push(env.DB.prepare("UPDATE contacts SET updated_at = ?, email = ? WHERE id = ?").bind(iso, v.email, contactId));
    } else {
      const source = v.utm_source || refHost(v.referrer, [url.hostname]) || "direct";
      stmts.push(env.DB.prepare(
        "INSERT INTO contacts (id, email, email_norm, name, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(contactId, v.email, emailNorm, v.name, iso, iso, source));
    }
  }

  stmts.push(env.DB.prepare(
    `INSERT INTO enquiries (id, contact_id, name, email, message, created_at, updated_at, source_page, referrer,
       utm_source, utm_medium, utm_campaign, status, spam_reason, marketing_consent, email_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, contactId, v.name, v.email, v.message, iso, iso, v.source_page, v.referrer || null,
    v.utm_source, v.utm_medium, v.utm_campaign, spam ? "spam" : "new", spam, v.marketing_consent ? 1 : 0,
    spam ? "skipped" : "pending"));

  if (!spam && v.marketing_consent) {
    stmts.push(env.DB.prepare(
      `INSERT INTO consent_records (id, contact_id, enquiry_id, action, wording, method, source_page, created_at, ip_hash, user_agent)
       VALUES (?, ?, ?, 'granted', ?, 'website form', ?, ?, ?, ?)`
    ).bind(newId(), contactId, id, CONSENT_WORDING, v.source_page, iso, await ipHash(env, ip, "consent"), ua));
    stmts.push(env.DB.prepare(
      "UPDATE contacts SET marketing_consent = 1, consent_at = ?, unsubscribed_at = NULL WHERE id = ?"
    ).bind(iso, contactId));
  }

  if (!spam) {
    stmts.push(env.DB.prepare(
      `INSERT INTO events (ts, day, type, name, path, visitor, session, ref_host, utm_source, utm_medium, utm_campaign, device, country)
       VALUES (?, ?, 'enquiry', NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).bind(iso, day, v.source_page, await visitorHash(env, day, ip, ua, url.hostname), v.sid,
      refHost(v.referrer, [url.hostname]), v.utm_source, v.utm_medium, v.utm_campaign,
      (request.cf && request.cf.country) || null));
  }

  await env.DB.batch(stmts);

  if (!spam) {
    const stored = { id, ...v, created_at: iso };
    ctx.waitUntil(deliverEnquiry(env, stored, { acknowledge: true }).catch((err) => console.error("delivery", id, err.message)));
  }
  // Spam gets the same answer as a real enquiry, so bots learn nothing.
  return reply(200, { ok: true, id });
}

/* Confirmation page for visitors without JavaScript. */
function confirmationPage(status, data) {
  const okay = status === 200;
  const message = okay
    ? "Thank you — your enquiry has been sent. Manuchie will be in touch soon."
    : status === 429
      ? "Too many attempts — please wait a minute and try again."
      : data.error === "validation" && data.fields && Object.keys(data.fields).length
        ? Object.values(data.fields).join(" ")
        : "Sorry — your enquiry couldn't be sent. Please try again in a moment.";
  const nonce = randomToken(12);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${okay ? "Enquiry sent" : "Enquiry not sent"} — Manuchie</title>
<link rel="stylesheet" href="/fonts.css">
<style nonce="${nonce}">
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0b;color:#f3f3f1;font:1.06rem/1.6 Inter,-apple-system,"Segoe UI",sans-serif;padding:1.5rem}
main{max-width:34rem}h1{font:400 clamp(2rem,6vw,3rem)/1.1 Newsreader,Georgia,serif;margin:0 0 1rem}
p{margin:0 0 2rem;color:rgba(243,243,241,.8)}a{display:inline-block;padding:.9rem 1.6rem;border-radius:999px;background:#fff;color:#0a0a0b;text-decoration:none;font-weight:500}
a:focus-visible{outline:2px solid #fff;outline-offset:3px}
</style></head>
<body><main><h1>${okay ? "Thank you." : "Not sent yet."}</h1><p role="status">${escapeHtml(message)}</p>
<a href="/${okay ? "" : "#contact"}">${okay ? "Back to manuchie.org" : "Back to the form"}</a></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}' 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    },
  });
}
