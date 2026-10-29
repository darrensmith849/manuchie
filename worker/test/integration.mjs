#!/usr/bin/env node
/* End-to-end test of the Worker on `wrangler dev` with a throwaway local D1 database and a
   mock email server standing in for Resend. Nothing touches production.
   Run after ./build.sh:   node worker/test/integration.mjs
   Prints one line per check and exits non-zero if any fail. */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 8787, MAIL_PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = BASE;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ADMIN = "admin@example.test";
const PASSWORD = randomBytes(18).toString("base64url"); // generated per run, never printed

if (!existsSync(join(ROOT, "dist", "index.html"))) { console.error("Run ./build.sh first."); process.exit(1); }

/* ---------- throwaway environment ---------- */
const tmp = mkdtempSync(join(tmpdir(), "manuchie-it-"));
const state = join(tmp, "state");
const assets = join(tmp, "dist");
cpSync(join(ROOT, "dist"), assets, { recursive: true });
if (!existsSync(join(assets, "admin"))) cpSync(join(ROOT, "admin"), join(assets, "admin"), { recursive: true });
const envFile = join(tmp, "test.env");
writeFileSync(envFile, [
  "MAIL_TO=inbox@example.test",
  "MAIL_FROM=Manuchie Website <enquiries@example.test>",
  "RESEND_API_KEY=re_test_not_real",
  `RESEND_API_URL=http://127.0.0.1:${MAIL_PORT}/emails`,
  "SEND_ACKNOWLEDGEMENT=true",
].join("\n"));

const mail = [];
const mailServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => { try { mail.push({ auth: req.headers.authorization, ...JSON.parse(body) }); } catch { /* ignore */ } res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"mock"}'); });
}).listen(MAIL_PORT, "127.0.0.1");

const wr = (args, opts = {}) => spawnSync("npx", ["--yes", "wrangler@4.155.0", ...args], { cwd: ROOT, encoding: "utf8", ...opts });
const mig = wr(["d1", "migrations", "apply", "manuchie", "--local", "--persist-to", state]);
if (mig.status !== 0) { console.error(mig.stdout, mig.stderr); process.exit(1); }
const adm = spawnSync("node", ["scripts/create-admin.mjs", "--email", ADMIN, "--local", "--persist-to", state, "--password-stdin"],
  { cwd: ROOT, input: PASSWORD + "\n", encoding: "utf8" });
if (adm.status !== 0) { console.error(adm.stdout, adm.stderr); process.exit(1); }

const dev = spawn("npx", ["--yes", "wrangler@4.155.0", "dev", "--local", "--ip", "127.0.0.1", "--port", String(PORT), "--persist-to", state,
  "--env-file", envFile, "--assets", assets, "--infer-origin-from-routes=false", "--show-interactive-dev-session=false", "--test-scheduled"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
let devLog = "";
dev.stdout.on("data", (d) => (devLog += d));
dev.stderr.on("data", (d) => (devLog += d));
for (let i = 0; i < 120 && !/Ready on/.test(devLog); i++) await new Promise((r) => setTimeout(r, 500));
if (!/Ready on/.test(devLog)) { console.error(devLog); dev.kill(); process.exit(1); }

/* ---------- helpers ---------- */
const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok: Boolean(ok), info }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info && !ok ? "  — " + info : ""}`); };
let cookie = "", csrf = "";
async function req(path, { method = "GET", body, form, headers = {}, origin = ORIGIN, auth = false, ua = UA } = {}) {
  const h = { "User-Agent": ua, ...headers };
  if (origin) h.Origin = origin;
  if (auth && cookie) h.Cookie = cookie;
  if (auth && csrf && method !== "GET") h["X-CSRF-Token"] = csrf;
  let payload;
  if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = typeof body === "string" ? body : JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual" });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, data };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const enquiry = (over = {}) => ({ name: "Ada Mensah", email: "ada@example.test", message: "We're recording a worship EP in March and would love you to produce it.",
  marketing_consent: true, botcheck: false, started_at: Date.now() - 20000, source_page: "/", referrer: "https://www.instagram.com/p/abc?igsh=x",
  utm_source: "instagram", utm_medium: "social", utm_campaign: "launch", sid: "tab_one", ...over });

try {
  /* public site and gates */
  let r = await req("/");
  check("Public page is served", r.status === 200 && /<html/i.test(r.data));
  check("Public page has security headers (CSP, HSTS, nosniff)", r.headers.get("content-security-policy") && r.headers.get("strict-transport-security") && r.headers.get("x-content-type-options") === "nosniff",
    [...r.headers.keys()].join(","));
  r = await req("/admin/", { origin: null });
  check("Dashboard redirects to sign-in when signed out", r.status === 302 && r.headers.get("location") === "/admin/login");
  r = await req("/admin/app.js", { origin: null });
  check("Dashboard script is not served when signed out", r.status === 302);
  r = await req("/admin/login", { origin: null });
  check("Sign-in page is served, private headers", r.status === 200 && r.headers.get("cache-control") === "no-store" && /noindex/.test(r.headers.get("x-robots-tag") || ""));
  r = await req("/api/admin/overview", { origin: null });
  check("Dashboard API refuses anonymous requests (401)", r.status === 401);
  r = await req("/api/enquiry", { origin: null });
  check("Enquiry endpoint rejects GET (405)", r.status === 405);

  /* enquiries */
  r = await req("/api/enquiry", { method: "POST", body: enquiry(), origin: null });
  check("Enquiry without Origin header is refused (403)", r.status === 403);
  r = await req("/api/enquiry", { method: "POST", body: enquiry(), origin: "https://evil.example" });
  check("Enquiry from another site is refused (403)", r.status === 403);
  r = await req("/api/enquiry", { method: "POST", body: { name: "", email: "nope", message: "" } });
  check("Invalid enquiry returns field errors (400)", r.status === 400 && r.data.fields && r.data.fields.name && r.data.fields.email && r.data.fields.message);
  r = await req("/api/enquiry", { method: "POST", body: "{not json" });
  check("Malformed JSON is rejected (400)", r.status === 400);
  r = await req("/api/enquiry", { method: "POST", body: enquiry({ message: "x".repeat(25000) }) });
  check("Oversized body is rejected (413)", r.status === 413);

  r = await req("/api/enquiry", { method: "POST", body: enquiry() });
  const firstId = r.data && r.data.id;
  check("Valid enquiry is accepted (200, id)", r.status === 200 && r.data.ok && /^[0-9a-f-]{36}$/.test(firstId || ""));
  await wait(1500);
  const toInbox = mail.find((m) => m.to && m.to[0] === "inbox@example.test");
  check("Enquiry email sent to Manuchie's address with Reply-To the visitor", toInbox && toInbox.reply_to === "ada@example.test" && /worship EP/.test(toInbox.text) && toInbox.auth === "Bearer re_test_not_real");
  const ack = mail.find((m) => m.to && m.to[0] === "ada@example.test");
  check("Acknowledgement sent to the visitor without repeating their message", ack && !/worship EP/.test(ack.text + ack.html));

  r = await req("/api/enquiry", { method: "POST", body: enquiry({ name: "Bot", email: "bot@example.test", botcheck: true }) });
  check("Honeypot submission gets the same success answer", r.status === 200 && r.data.ok);
  r = await req("/api/enquiry", { method: "POST", form: { name: "No Script", email: "noscript@example.test", message: "Form post without JavaScript." } });
  check("No-JavaScript form post gets an HTML confirmation page", r.status === 200 && /Thank you/.test(r.data) && /text\/html/.test(r.headers.get("content-type")));
  r = await req("/api/enquiry", { method: "POST", body: enquiry({ name: "Ada M.", message: "A second idea: a live album.", marketing_consent: false, sid: "tab_two" }) });
  check("Second enquiry from the same email is accepted", r.status === 200);
  let limited = false;
  for (let i = 0; i < 4 && !limited; i++) {
    r = await req("/api/enquiry", { method: "POST", body: enquiry({ email: `flood${i}@example.test`, marketing_consent: false }) });
    limited = r.status === 429;
  }
  check("Enquiries are rate limited per visitor (429 after 5 in 10 minutes)", limited && r.data.error === "rate_limited");

  /* analytics */
  const beacon = (data, ua = UA, extra = {}) => req("/api/collect", { method: "POST", body: { path: "/", w: 1440, ...data }, ua, ...extra });
  r = await beacon({ type: "pageview", sid: "tab_one", ref: "https://www.instagram.com/", utm_source: "instagram" });
  check("Analytics beacon accepted (204)", r.status === 204);
  await beacon({ type: "pageview", sid: "tab_three", ref: "https://www.google.com/" });
  await beacon({ type: "section_view", name: "sound", sid: "tab_one" });
  await beacon({ type: "click", name: "spotify", sid: "tab_one" });
  await beacon({ type: "click", name: "spotify", sid: "tab_three" });
  await beacon({ type: "click", name: "book_session", sid: "tab_one" });
  await beacon({ type: "form_start", sid: "tab_one" });
  await beacon({ type: "pageview", sid: "bot" }, "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
  await beacon({ type: "pageview", sid: "other" }, UA, { origin: "https://evil.example" });
  await beacon({ type: "keystroke", sid: "tab_one", name: "secret" });

  /* sign-in */
  r = await req("/api/admin/login", { method: "POST", body: { email: ADMIN, password: "wrong-password-123" } });
  check("Wrong password is refused (401)", r.status === 401);
  r = await req("/api/admin/login", { method: "POST", body: { email: ADMIN, password: PASSWORD }, origin: "https://evil.example" });
  check("Sign-in from another site is refused (403)", r.status === 403);
  r = await req("/api/admin/login", { method: "POST", body: { email: ADMIN, password: PASSWORD } });
  const setCookie = r.headers.get("set-cookie") || "";
  check("Correct password signs in", r.status === 200 && r.data.ok);
  check("Session cookie is __Host-, HttpOnly, Secure, SameSite=Strict, 12 h", /^__Host-mz_admin=/.test(setCookie) && /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Strict/.test(setCookie) && /Max-Age=43200/.test(setCookie));
  cookie = setCookie.split(";")[0];
  r = await req("/api/admin/me", { auth: true });
  csrf = r.data.csrf;
  check("Signed-in user gets their email and a CSRF token", r.status === 200 && r.data.email === ADMIN && csrf && csrf.length > 20);
  r = await req("/admin/", { auth: true, origin: null });
  check("Dashboard is served when signed in, no-store + CSP", r.status === 200 && /app\.js/.test(r.data) && r.headers.get("cache-control") === "no-store" && /frame-ancestors 'none'/.test(r.headers.get("content-security-policy") || ""));
  r = await req("/admin/login", { auth: true, origin: null });
  check("Sign-in page redirects to the dashboard when already signed in", r.status === 302 && r.headers.get("location") === "/admin/");

  await beacon({ type: "pageview", sid: "admin_tab" }, UA, { auth: true });
  r = await req("/api/admin/overview?range=7d", { auth: true });
  const ov = r.data;
  check("Overview loads", r.status === 200 && ov.current && Array.isArray(ov.series) && ov.series.length === 7 && Array.isArray(ov.previousSeries));
  check("Page views counted once each; bots, other sites and admin excluded (2)", ov.current.pageviews === 2, "got " + ov.current.pageviews);
  check("Unique visitors and visits counted", ov.current.visits === 2 && ov.current.visitors >= 1, JSON.stringify(ov.current));
  check("Spotify clicks (2) and Book-a-session clicks (1) counted", ov.current.clicks.spotify === 2 && ov.current.clicks.book_session === 1, JSON.stringify(ov.current.clicks));
  check("Enquiries counted without spam or rate-limited attempts (4)", ov.current.enquiries === 4, "got " + ov.current.enquiries);
  check("Unread enquiries reported (4)", ov.unread === 4, "got " + ov.unread);
  check("Traffic sources ranked (instagram, google.com)", ov.sources.some((s) => s.name === "instagram") && ov.sources.some((s) => s.name === "google.com"), JSON.stringify(ov.sources));
  check("Recent enquiries list has no message text", ov.recent.length && ov.recent.every((e) => !("message" in e)));
  r = await req("/api/admin/analytics?range=30d", { auth: true });
  check("Analytics loads with funnel, devices and sections", r.status === 200 && r.data.funnel.form_starts === 1 && r.data.devices.length && r.data.sections.some((s) => s.name === "sound"));
  r = await req("/api/admin/analytics?range=custom&from=2026-01-01&to=2026-01-31", { auth: true });
  check("Custom date range works", r.status === 200 && r.data.range.from === "2026-01-01" && r.data.series.length === 31);

  /* enquiry management */
  r = await req("/api/admin/enquiries", { auth: true });
  check("Enquiry list hides spam by default", r.status === 200 && r.data.rows.every((e) => e.status !== "spam") && r.data.counts.spam === 1, JSON.stringify(r.data.counts));
  r = await req("/api/admin/enquiries?status=spam", { auth: true });
  check("Spam filter shows the honeypot submission", r.data.rows.length === 1 && r.data.rows[0].email === "bot@example.test");
  const spamId = r.data.rows[0].id;
  r = await req("/api/admin/enquiries?q=noscript", { auth: true });
  check("Search by email finds the no-JS enquiry", r.data.total === 1 && r.data.rows[0].name === "No Script");
  r = await req("/api/admin/enquiries?q=%25", { auth: true });
  check("Search treats % literally", r.data.total === 0);
  r = await req(`/api/admin/enquiries/${firstId}`, { auth: true });
  check("Opening an enquiry shows the full message and marks it read", r.status === 200 && /worship EP/.test(r.data.enquiry.message) && r.data.enquiry.status === "read");
  check("Enquiry stores source page, referrer (no query string) and UTM", r.data.enquiry.referrer === "https://www.instagram.com/p/abc" && r.data.enquiry.utm_campaign === "launch" && r.data.enquiry.source_page === "/");
  check("Email delivery status recorded as sent", r.data.enquiry.email_status === "sent" && r.data.enquiry.ack_status === "sent");
  r = await req(`/api/admin/enquiries/${firstId}`, { method: "PATCH", body: { status: "booked" }, auth: true });
  check("Status change with CSRF token succeeds", r.status === 200 && r.data.enquiry.status === "booked");
  const noCsrf = await fetch(BASE + `/api/admin/enquiries/${firstId}`, { method: "PATCH", headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json", "User-Agent": UA }, body: '{"status":"closed"}' });
  check("Status change without CSRF token is refused (403)", noCsrf.status === 403);
  const badOrigin = await fetch(BASE + `/api/admin/enquiries/${firstId}`, { method: "PATCH", headers: { Cookie: cookie, Origin: "https://evil.example", "X-CSRF-Token": csrf, "Content-Type": "application/json", "User-Agent": UA }, body: '{"status":"closed"}' });
  check("Status change from another origin is refused (403)", badOrigin.status === 403);
  r = await req(`/api/admin/enquiries/${firstId}`, { method: "PATCH", body: { notes: "Call back Tuesday.", replied: true }, auth: true });
  check("Notes saved and reply recorded (booked status kept)", r.data.enquiry.notes === "Call back Tuesday." && r.data.enquiry.last_contacted_at && r.data.enquiry.status === "booked");
  r = await req(`/api/admin/enquiries/${firstId}`, { auth: true });
  check("Status, notes and reply persist after reload", r.data.enquiry.status === "booked" && r.data.enquiry.notes === "Call back Tuesday.");
  r = await req(`/api/admin/enquiries/${firstId}`, { method: "PATCH", body: { status: "nonsense" }, auth: true });
  check("Unknown status is rejected (400)", r.status === 400);
  r = await req(`/api/admin/enquiries.csv?ids=${firstId}`, { auth: true });
  check("CSV export of selected enquiries", r.status === 200 && /^\uFEFF?ID,Received/.test(r.data) && r.data.includes("ada@example.test") && /attachment/.test(r.headers.get("content-disposition")));
  r = await req(`/api/admin/enquiries/${spamId}`, { method: "PATCH", body: { status: "new" }, auth: true });
  check("Marking spam as genuine links it to a contact", r.status === 200 && r.data.contact && r.data.contact.id);

  /* contacts */
  r = await req("/api/admin/contacts?q=ada%40example.test", { auth: true });
  const ada = r.data.rows[0];
  check("One contact per email, with enquiry count 2 (no duplicates)", r.data.total === 1 && ada.enquiry_count === 2, JSON.stringify(r.data.rows.map((x) => [x.email, x.enquiry_count])));
  check("Contact shows consent and timestamp", ada.marketing_consent === 1 && ada.consent_at);
  r = await req(`/api/admin/contacts/${ada.id}`, { method: "PATCH", body: { tags: "Church, artist, church", notes: "Met at Harare launch." }, auth: true });
  check("Tags (deduplicated) and notes saved", JSON.stringify(r.data.contact.tags) === '["church","artist"]' && r.data.contact.notes === "Met at Harare launch.");
  r = await req("/api/admin/contacts?tag=church", { auth: true });
  check("Filter contacts by tag", r.data.total === 1);
  r = await req("/api/admin/consent", { auth: true });
  check("Consent record stores the exact checkbox wording", r.data.rows.some((x) => x.email === "ada@example.test" && x.action === "granted" && /Keep me posted/.test(x.wording)) && r.data.summary.marketable >= 1);
  r = await req("/api/admin/consent.csv", { auth: true });
  check("Marketing export includes the opted-in contact", r.data.includes("ada@example.test") && !r.data.includes("noscript@example.test"));
  r = await req(`/api/admin/contacts/${ada.id}`, { method: "PATCH", body: { unsubscribe: true }, auth: true });
  check("Unsubscribe records a withdrawal", r.data.consent.some((x) => x.action === "withdrawn") && r.data.contact.marketing_consent === 0);
  r = await req("/api/admin/consent.csv", { auth: true });
  check("Withdrawn contact is left out of the marketing export", !r.data.includes("ada@example.test"));
  r = await req(`/api/admin/contacts/${ada.id}/export`, { auth: true });
  check("Personal-data export (JSON) has the contact, enquiries and consent history", r.status === 200 && r.data.contact && r.data.enquiries.length === 2 && r.data.consent.length === 2);
  r = await req("/api/admin/contacts.csv", { auth: true });
  check("Contacts CSV export", r.status === 200 && /Marketing consent/.test(r.data));
  r = await req(`/api/admin/contacts/${ada.id}`, { method: "DELETE", auth: true });
  check("Deleting a contact succeeds", r.status === 200);
  r = await req(`/api/admin/enquiries/${firstId}`, { auth: true });
  check("Their enquiries are erased with them", r.status === 404);

  /* settings and sessions */
  r = await req("/api/admin/settings", { auth: true });
  check("Settings show email configuration without revealing the address", r.status === 200 && r.data.email.configured && r.data.email.to !== "inbox@example.test" && r.data.sessions.some((x) => x.current));
  r = await req("/api/admin/settings/password", { method: "POST", body: { current: "wrong", next: "a-new-password-long-enough" }, auth: true });
  check("Password change needs the current password", r.status === 400 && r.data.error === "current");
  r = await req("/api/admin/settings/password", { method: "POST", body: { current: PASSWORD, next: "short" }, auth: true });
  check("Password change enforces 12+ characters", r.status === 400 && r.data.error === "weak");

  /* scheduled housekeeping */
  r = await fetch(BASE + "/__scheduled?cron=17+3+*+*+*");
  check("Daily housekeeping (cron) runs without error", r.status === 200);

  /* logout and lockout */
  r = await req("/api/admin/logout", { method: "POST", auth: true });
  check("Log out clears the cookie", r.status === 200 && /Max-Age=0/.test(r.headers.get("set-cookie") || ""));
  r = await req("/api/admin/me", { auth: true });
  check("Old session no longer works after log out (401)", r.status === 401);
  let locked = false;
  for (let i = 0; i < 6 && !locked; i++) {
    r = await req("/api/admin/login", { method: "POST", body: { email: ADMIN, password: "still-wrong-" + i } });
    locked = r.status === 429;
  }
  check("Repeated wrong passwords lock the account for 15 minutes (429)", locked);
  r = await req("/api/admin/login", { method: "POST", body: { email: ADMIN, password: PASSWORD } });
  check("Even the right password is refused during the lockout", r.status === 429);
  check("No message text appears in the Worker log", !/worship EP|live album|Form post without JavaScript/.test(devLog));
} catch (err) {
  check("Test run finished without crashing", false, err.stack);
} finally {
  dev.kill("SIGINT");
  mailServer.close();
  await wait(500);
  rmSync(tmp, { recursive: true, force: true });
}

const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} checks passed`);
process.exit(failedCount ? 1 : 0);
