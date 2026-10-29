/* Transactional email through Resend's HTTPS API (https://resend.com/docs/api-reference).
   Needs MAIL_TO, MAIL_FROM and RESEND_API_KEY. Without them enquiries are still stored and
   shown in the dashboard; email_status records "not_configured". */

import { escapeHtml } from "./lib/http.js";

export const emailConfigured = (env) => Boolean(env.RESEND_API_KEY && env.MAIL_TO && env.MAIL_FROM);
export const ackEnabled = (env) => emailConfigured(env) && String(env.SEND_ACKNOWLEDGEMENT).toLowerCase() === "true";

async function send(env, message) {
  const res = await fetch(env.RESEND_API_URL || "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
}

const SITE = "https://manuchie.org";

/* The full enquiry to Manuchie. Reply-To is the visitor, so "Reply" answers them directly. */
export function enquiryEmail(env, e) {
  const lines = [
    `New enquiry from the Manuchie website`,
    ``,
    `Name: ${e.name}`,
    `Email: ${e.email}`,
    `Received: ${e.created_at.replace("T", " ").slice(0, 16)} UTC`,
    `Marketing consent: ${e.marketing_consent ? "yes" : "no"}`,
    e.source_page ? `Page: ${e.source_page}` : null,
    e.referrer ? `Came from: ${e.referrer}` : null,
    e.utm_source ? `Campaign: ${[e.utm_source, e.utm_medium, e.utm_campaign].filter(Boolean).join(" / ")}` : null,
    ``,
    `The project:`,
    e.message,
    ``,
    `Open in the dashboard: ${SITE}/admin/#/enquiries/${e.id}`,
  ].filter((l) => l !== null);
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#141416">` +
    `<p style="margin:0 0 16px"><strong>New enquiry from the Manuchie website</strong></p>` +
    `<table style="border-collapse:collapse;margin:0 0 16px">` +
    [["Name", e.name], ["Email", e.email], ["Received", e.created_at.replace("T", " ").slice(0, 16) + " UTC"],
     ["Marketing consent", e.marketing_consent ? "yes" : "no"]]
      .map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#6b6b70">${k}</td><td style="padding:2px 0">${escapeHtml(v)}</td></tr>`).join("") +
    `</table><p style="margin:0 0 6px;color:#6b6b70">The project</p>` +
    `<p style="margin:0 0 20px;white-space:pre-wrap">${escapeHtml(e.message)}</p>` +
    `<p style="margin:0"><a href="${SITE}/admin/#/enquiries/${encodeURIComponent(e.id)}" style="color:#b5481e">Open in the dashboard</a></p></div>`;
  return {
    from: env.MAIL_FROM,
    to: [env.MAIL_TO],
    reply_to: e.email,
    subject: `New enquiry from ${e.name}`,
    text: lines.join("\n"),
    html,
  };
}

/* Short confirmation to the visitor. It deliberately does not repeat their message, so the
   form can't be used to send arbitrary text to someone else's inbox. */
export function acknowledgementEmail(env, e) {
  const first = e.name.split(" ")[0];
  return {
    from: env.MAIL_FROM,
    to: [e.email],
    subject: "Thanks for getting in touch — Manuchie",
    text: `Hi ${first},\n\nThank you for your enquiry. It has reached Manuchie, and he'll be in touch soon.\n\nManuchie\n${SITE}\n`,
    html:
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#141416">` +
      `<p>Hi ${escapeHtml(first)},</p><p>Thank you for your enquiry. It has reached Manuchie, and he'll be in touch soon.</p>` +
      `<p>Manuchie<br><a href="${SITE}" style="color:#b5481e">manuchie.org</a></p></div>`,
  };
}

/* Sends both emails and records the outcome on the enquiry row. Never logs message content. */
export async function deliverEnquiry(env, enquiry, { acknowledge }) {
  let emailStatus = "not_configured";
  let ackStatus = "skipped";
  if (emailConfigured(env)) {
    try { await send(env, enquiryEmail(env, enquiry)); emailStatus = "sent"; }
    catch (err) { emailStatus = "failed"; console.error("enquiry email failed", enquiry.id, err.message); }
    if (acknowledge && ackEnabled(env)) {
      try { await send(env, acknowledgementEmail(env, enquiry)); ackStatus = "sent"; }
      catch (err) { ackStatus = "failed"; console.error("acknowledgement email failed", enquiry.id, err.message); }
    }
  }
  await env.DB.prepare("UPDATE enquiries SET email_status = ?, ack_status = ? WHERE id = ?")
    .bind(emailStatus, ackStatus, enquiry.id).run();
  return { emailStatus, ackStatus };
}
