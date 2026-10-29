#!/usr/bin/env node
/* Browser end-to-end test: the real public page talking to the real Worker on `wrangler dev`
   with a throwaway local database. A visitor lands with UTM tags, scrolls, clicks Spotify and
   sends an enquiry; then the admin signs in and the dashboard must show exactly that.
   Also: no-JavaScript form post, favicons/manifest, console errors, screenshots at 4 widths.

   PLAYWRIGHT_DIR=/path/with/node_modules CHROME_PATH=/path/to/chrome node worker/test/site-e2e.mjs
   Headless browser with its own temporary profile; never the user's browser. */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, cpSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(process.env.PLAYWRIGHT_DIR || ROOT, "node_modules", "x.js"));
const { chromium } = require("playwright");
const PORT = 8789;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(ROOT, "docs", "qa");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ADMIN = "admin@example.test";
const PASSWORD = randomBytes(18).toString("base64url");
mkdirSync(OUT, { recursive: true });

const tmp = mkdtempSync(join(tmpdir(), "manuchie-e2e-"));
const state = join(tmp, "state");
cpSync(join(ROOT, "dist"), join(tmp, "dist"), { recursive: true });
writeFileSync(join(tmp, "e2e.env"), "SEND_ACKNOWLEDGEMENT=false\n");
const must = (r) => { if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); } return r; };
must(spawnSync("npx", ["--yes", "wrangler@4.155.0", "d1", "migrations", "apply", "manuchie", "--local", "--persist-to", state], { cwd: ROOT, encoding: "utf8" }));
must(spawnSync("node", ["scripts/create-admin.mjs", "--email", ADMIN, "--local", "--persist-to", state, "--password-stdin"], { cwd: ROOT, input: PASSWORD + "\n", encoding: "utf8" }));
const dev = spawn("npx", ["--yes", "wrangler@4.155.0", "dev", "--local", "--ip", "127.0.0.1", "--port", String(PORT), "--persist-to", state,
  "--env-file", join(tmp, "e2e.env"), "--assets", join(tmp, "dist"), "--infer-origin-from-routes=false", "--show-interactive-dev-session=false"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
let devLog = "";
dev.stdout.on("data", (d) => (devLog += d)); dev.stderr.on("data", (d) => (devLog += d));
for (let i = 0; i < 120 && !/Ready on/.test(devLog); i++) await new Promise((r) => setTimeout(r, 500));

const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok: Boolean(ok), info }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info && !ok ? "  — " + info : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const ignorable = (t) => /spotify|scdn|apple\.com|mzstatic|Failed to load resource.*(spotify|apple)/i.test(t);

try {
  /* static identity files */
  for (const [path, type] of [["/favicon.ico", "image"], ["/favicon.svg", "svg"], ["/apple-touch-icon.png", "image/png"], ["/site.webmanifest", "manifest"]]) {
    const r = await fetch(BASE + path);
    check(`${path} is served (${r.headers.get("content-type")})`, r.status === 200 && new RegExp(type).test(r.headers.get("content-type") || ""));
  }
  const robots = await (await fetch(BASE + "/robots.txt")).text();
  check("robots.txt disallows /admin and /api/", /Disallow: \/admin/.test(robots) && /Disallow: \/api\//.test(robots));

  /* a visitor */
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !ignorable(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  const beacons = [];
  page.on("request", (r) => { if (r.url().endsWith("/api/collect")) beacons.push(JSON.parse(r.postData() || "{}")); });
  await page.goto(BASE + "/?utm_source=qa&utm_medium=test&utm_campaign=e2e", { waitUntil: "load" });
  check("Header shows the Hallmark lockup", await page.locator(".nav-logo img[alt='Manuchie']").evaluate((img) => img.complete && img.naturalWidth > 0));
  check("Footer shows the Hallmark wordmark", await page.locator("img.foot-logo").count() === 1);
  check("Old gold 'M' data: favicon is gone", !(await page.content()).includes("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect"));
  for (const id of ["story", "sound", "studio", "contact"]) {
    await page.locator("#" + id).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
  }
  await page.mouse.wheel(0, 99999);
  await page.waitForTimeout(800);
  const [popup] = await Promise.all([ctx.waitForEvent("page").catch(() => null), page.locator("a.foot-links a, .foot-links a").filter({ hasText: "Spotify" }).first().click()]);
  if (popup) await popup.close();
  await page.waitForTimeout(300);
  check("Pageview beacon sent once, with UTM tags", beacons.filter((b) => b.type === "pageview").length === 1 && beacons.find((b) => b.type === "pageview").utm_campaign === "e2e");
  check("Section views sent once each", new Set(beacons.filter((b) => b.type === "section_view").map((b) => b.name)).size === beacons.filter((b) => b.type === "section_view").length && beacons.some((b) => b.name === "contact"));
  check("Spotify click sent", beacons.some((b) => b.type === "click" && b.name === "spotify"));

  await page.locator("#contact").scrollIntoViewIfNeeded();
  await page.fill("#bookingForm [name=name]", "E2E Visitor");
  await page.fill("#bookingForm [name=email]", "e2e.visitor@example.test");
  await page.fill("#bookingForm [name=message]", "An end-to-end test enquiry about a worship EP.");
  await page.check("#bookingForm [name=marketing_consent]");
  check("form_start sent once, without any typed content", beacons.filter((b) => b.type === "form_start").length === 1 && !JSON.stringify(beacons).includes("end-to-end test enquiry"));
  await page.waitForTimeout(3200); // a person takes longer than the 3-second spam threshold
  let popups = 0;
  ctx.on("page", () => popups++);
  await page.click("#submitBtn");
  await page.waitForFunction(() => /Thank you/.test(document.getElementById("formStatus").textContent), null, { timeout: 15000 });
  check("In-page success message, no email app opened", popups === 0 && /Thank you — your enquiry has been sent/.test(await page.textContent("#formStatus")));
  check("Form is cleared after sending", (await page.inputValue("#bookingForm [name=message]")) === "");
  await page.screenshot({ path: join(OUT, "public-form-sent-1440.jpg"), type: "jpeg", quality: 80, clip: await page.locator("#contact").boundingBox() });
  check("No console errors from the page's own code", errors.length === 0, errors.join(" | "));
  await ctx.close();

  /* without JavaScript */
  const noJs = await browser.newContext({ userAgent: UA, javaScriptEnabled: false });
  const p2 = await noJs.newPage();
  await p2.goto(BASE + "/#contact");
  await p2.fill("#bookingForm [name=name]", "No Script Visitor");
  await p2.fill("#bookingForm [name=email]", "noscript@example.test");
  await p2.fill("#bookingForm [name=message]", "Sent with JavaScript switched off.");
  await Promise.all([p2.waitForNavigation(), p2.click("#submitBtn")]);
  check("Without JavaScript the form posts and shows the confirmation page", /Thank you/.test(await p2.textContent("body")) && p2.url().endsWith("/api/enquiry"));
  await noJs.close();

  /* the admin sees it */
  const adm = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
  const a = await adm.newPage();
  await a.goto(BASE + "/admin/login");
  await a.fill("input[name=email]", ADMIN);
  await a.fill("input[name=password]", PASSWORD);
  await a.click("#loginBtn");
  await a.waitForURL(BASE + "/admin/");
  await a.waitForSelector(".card-v");
  const ov = await a.evaluate(async () => (await (await fetch("/api/admin/overview?range=today")).json()));
  check("Dashboard: 1 visit, 1 page view, 1 visitor (admin's own visit not counted)", ov.current.visits === 1 && ov.current.pageviews === 1 && ov.current.visitors === 1, JSON.stringify(ov.current));
  check("Dashboard: Spotify click counted once", ov.current.clicks.spotify === 1, JSON.stringify(ov.current.clicks));
  check("Dashboard: 2 enquiries (JS and no-JS), conversion shown", ov.current.enquiries === 2 && ov.current.conversion > 0);
  check("Dashboard: traffic source is the UTM source 'qa'", ov.sources.some((s) => s.name === "qa"));
  check("Dashboard: the contact section is among the sections viewed", ov.sections.some((s) => s.name === "contact"));
  const an = await a.evaluate(async () => (await (await fetch("/api/admin/analytics?range=today")).json()));
  check("Analytics: funnel counts the form start and the enquiry", an.funnel.form_starts === 1 && an.funnel.enquiries === 2);
  check("Analytics: campaign row qa / test / e2e", an.campaigns.some((c) => c.source === "qa" && c.medium === "test" && c.campaign === "e2e"));
  check("Analytics: device recorded as desktop", an.devices.some((d) => d.name === "desktop"));
  const list = await a.evaluate(async () => (await (await fetch("/api/admin/enquiries?q=e2e.visitor")).json()));
  const e = list.rows[0];
  check("Enquiry stored with consent and shown as new", list.total === 1 && e.marketing_consent === 1 && e.status === "new");
  const full = await a.evaluate(async (id) => (await (await fetch("/api/admin/enquiries/" + id)).json()), e.id);
  check("Enquiry has source page, UTM and the full message", full.enquiry.utm_campaign === "e2e" && full.enquiry.source_page === "/" && /worship EP/.test(full.enquiry.message));
  const consent = await a.evaluate(async () => (await (await fetch("/api/admin/consent")).json()));
  check("Consent proof stored with the exact label wording from the page", consent.rows.some((r) => r.email === "e2e.visitor@example.test" && r.wording === "Keep me posted about new music and projects from Manuchie. Optional — you can unsubscribe at any time."));
  await a.goto(BASE + "/admin/#/enquiries");
  await a.waitForSelector("table");
  await a.screenshot({ path: join(OUT, "dashboard-enquiries-e2e-1440.jpg"), type: "jpeg", quality: 80 });
  await adm.close();

  /* screenshots of the finished public page */
  for (const width of [390, 768, 1024, 1440]) {
    const c = await browser.newContext({ userAgent: UA, viewport: { width, height: width < 800 ? 844 : 900 }, reducedMotion: "reduce" });
    const p = await c.newPage();
    await p.goto(BASE + "/");
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    await p.waitForTimeout(600);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${width}px: no horizontal overflow`, overflow <= 0, overflow + "px");
    await p.screenshot({ path: join(OUT, `public-${width}.jpg`), type: "jpeg", quality: 72, fullPage: true });
    await p.screenshot({ path: join(OUT, `public-top-${width}.jpg`), type: "jpeg", quality: 85 });
    await c.close();
  }
} catch (err) {
  check("Test run finished without crashing", false, err.stack);
} finally {
  await browser.close();
  dev.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 500));
  rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
writeFileSync(join(OUT, "site-e2e-results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
