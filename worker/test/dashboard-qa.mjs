#!/usr/bin/env node
/* Visual and accessibility QA of the private dashboard on `wrangler dev`, with a throwaway
   local database filled with clearly fake sample data (example.test addresses).
   Screenshots every page at 390 / 768 / 1024 / 1440 px into docs/qa/, checks for horizontal
   overflow and console errors, and runs axe-core accessibility checks.

   Needs Playwright and axe-core installed OUTSIDE the repo:
     PLAYWRIGHT_DIR=/path/with/node_modules CHROME_PATH=/path/to/chrome node worker/test/dashboard-qa.mjs
   Uses a headless browser with its own temporary profile; never the user's browser. */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, cpSync, rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(process.env.PLAYWRIGHT_DIR || ROOT, "node_modules", "x.js"));
const { chromium } = require("playwright");
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(ROOT, "docs", "qa");
const ADMIN = "admin@example.test";
const PASSWORD = randomBytes(18).toString("base64url");
mkdirSync(OUT, { recursive: true });

/* ---------- environment ---------- */
const tmp = mkdtempSync(join(tmpdir(), "manuchie-qa-"));
const state = join(tmp, "state");
const assets = join(tmp, "dist");
cpSync(join(ROOT, "dist"), assets, { recursive: true });
rmSync(join(assets, "admin"), { recursive: true, force: true });
cpSync(join(ROOT, "admin"), join(assets, "admin"), { recursive: true });
const envFile = join(tmp, "qa.env");
writeFileSync(envFile, "SEND_ACKNOWLEDGEMENT=false\n");
const wr = (args, opts = {}) => spawnSync("npx", ["--yes", "wrangler@4.155.0", ...args], { cwd: ROOT, encoding: "utf8", ...opts });
const must = (r) => { if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); } return r; };
must(wr(["d1", "migrations", "apply", "manuchie", "--local", "--persist-to", state]));
must(spawnSync("node", ["scripts/create-admin.mjs", "--email", ADMIN, "--local", "--persist-to", state, "--password-stdin"], { cwd: ROOT, input: PASSWORD + "\n", encoding: "utf8" }));

/* ---------- sample data (fake) ---------- */
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const weighted = (pairs) => { let x = rnd() * pairs.reduce((a, [, w]) => a + w, 0); for (const [v, w] of pairs) if ((x -= w) <= 0) return v; return pairs[0][0]; };
const q = (v) => (v === null || v === undefined ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'");
const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const dayOf = (back) => new Date(today.getTime() - back * 86400000).toISOString().slice(0, 10);
const sql = [];
const events = [];
for (let back = 89; back >= 0; back--) {
  const day = dayOf(back);
  const visits = Math.round(18 + 10 * Math.sin(back / 6) + rnd() * 14 + (back < 20 ? 12 : 0));
  for (let v = 0; v < visits; v++) {
    const session = hex(16), visitor = hex(24);
    const src = weighted([[[null, null], 34], [["instagram", null], 26], [[null, "google.com"], 18], [[null, "youtube.com"], 8], [[null, "facebook.com"], 7], [["newsletter", null], 4], [[null, "open.spotify.com"], 3]]);
    const device = weighted([["mobile", 62], ["desktop", 31], ["tablet", 7]]);
    const country = weighted([["ZW", 34], ["ZA", 22], ["AU", 16], ["US", 10], ["GB", 7], ["NG", 5], ["KE", 4], [null, 2]]);
    const ts = `${day}T${String(Math.floor(rnd() * 24)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00.000Z`;
    const base = [ts, day, "/", visitor, session];
    events.push([...base, "pageview", null, src[1], src[0], src[0] === "instagram" ? "social" : src[0] ? "email" : null, src[0] === "instagram" ? "launch" : null, device, country]);
    for (const [s, p] of [["hero", 0.98], ["story", 0.7], ["mantra", 0.55], ["sound", 0.6], ["studio", 0.42], ["gallery", 0.36], ["contact", 0.3]]) {
      if (rnd() < p) events.push([...base, "section_view", s, null, null, null, null, device, country]);
    }
    for (const [c, p] of [["spotify", 0.22], ["apple_music", 0.06], ["youtube", 0.09], ["shazam", 0.02], ["instagram", 0.07], ["email", 0.03], ["book_session", 0.08]]) {
      if (rnd() < p) events.push([...base, "click", c, null, null, null, null, device, country]);
    }
    if (rnd() < 0.05) events.push([...base, "form_start", null, null, null, null, null, device, country]);
  }
}
for (let i = 0; i < events.length; i += 400) {
  sql.push("INSERT INTO events (ts, day, path, visitor, session, type, name, ref_host, utm_source, utm_medium, utm_campaign, device, country) VALUES " +
    events.slice(i, i + 400).map((e) => "(" + e.map(q).join(",") + ")").join(",") + ";");
}
const people = [
  ["Tariro Moyo", "Hi Manuchie, our church choir is recording a live worship album in Harare in February. Would you be available to produce and music direct?"],
  ["Grace Fellowship Worship", "We're building a new worship team and would love help shaping our sound — arrangements and a couple of originals."],
  ["Daniel Okafor", "Looking for a producer for a 4-track gospel EP. Vocals are written; I need arrangements, keys and mixing."],
  ["Sample Label Ltd", "We'd like to discuss production for two artists on our roster for next year."],
  ["Ruth Chikwanha", "Can you write and produce a song for our wedding? Timing is flexible."],
  ["Kudzai Ncube", "I'm a singer-songwriter from Bulawayo. I'd like to book a remote session for vocal production."],
  ["Hope City Church", "Music direction for our Easter conference, 3 nights, band of 9."],
  ["Lerato Dube", "Interested in keyboard recording for my single. Do you work remotely?"],
  ["Jordan Ellis", "Hey! Big fan of Mourning to Dancing. Would love to collaborate on a cross-over record."],
  ["Sample Collective", "We're an Australian worship collective planning a Zimbabwe trip and want to co-write."],
];
const statuses = ["new", "new", "new", "read", "replied", "in_progress", "booked", "closed"];
const sources = [["instagram", "social", "launch", "https://l.instagram.com/"], [null, null, null, "https://www.google.com/"], [null, null, null, null], ["newsletter", "email", "october", null]];
let n = 0;
for (const [name, message] of people) {
  const cid = uuid();
  const email = name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "") + "@example.test";
  const times = 1 + (rnd() < 0.3 ? 1 : 0);
  const consent = rnd() < 0.5;
  const first = Math.floor(rnd() * 80) + 1;
  const created = new Date(today.getTime() - first * 86400000 + 36000000).toISOString();
  const [us, um, uc, ref] = pick(sources);
  sql.push(`INSERT INTO contacts (id, email, email_norm, name, created_at, updated_at, source, marketing_consent, consent_at, tags, notes) VALUES (${[cid, email, email, name, created, created, us || (ref ? new URL(ref).hostname.replace(/^(www|l)\./, "") : "direct"), consent ? 1 : 0, consent ? created : null, JSON.stringify(n % 3 === 0 ? ["church"] : n % 3 === 1 ? ["artist"] : []), n === 0 ? "Choir of 40. Budget confirmed." : ""].map(q).join(",")});`);
  for (let t = 0; t < times; t++) {
    const id = uuid();
    const at = new Date(Date.parse(created) + t * 9 * 86400000).toISOString();
    const status = n < 3 && t === times - 1 ? "new" : pick(statuses);
    sql.push(`INSERT INTO enquiries (id, contact_id, name, email, message, created_at, updated_at, source_page, referrer, utm_source, utm_medium, utm_campaign, status, marketing_consent, email_status, last_contacted_at, notes) VALUES (${[id, cid, name, email, t ? "Following up on my earlier message — " + message.toLowerCase() : message, at, at, "/", ref, us, um, uc, status, consent ? 1 : 0, "not_configured", ["replied", "booked", "in_progress"].includes(status) ? at : null, status === "booked" ? "Session booked for the 14th." : ""].map(q).join(",")});`);
    if (consent && t === 0) sql.push(`INSERT INTO consent_records (id, contact_id, enquiry_id, action, wording, method, source_page, created_at) VALUES (${[uuid(), cid, id, "granted", "Keep me posted about new music and projects from Manuchie. Optional — you can unsubscribe at any time.", "website form", "/", at].map(q).join(",")});`);
  }
  n++;
}
sql.push(`INSERT INTO enquiries (id, contact_id, name, email, message, created_at, updated_at, status, spam_reason, email_status) VALUES (${[uuid(), null, "Cheap SEO", "seo@spam.example.test", "Get rank 1 http://x http://y http://z www.w", new Date(today.getTime() - 3 * 86400000).toISOString(), new Date().toISOString(), "spam", "links", "skipped"].map(q).join(",")});`);
const seedFile = join(tmp, "seed.sql");
writeFileSync(seedFile, sql.join("\n"));
must(wr(["d1", "execute", "manuchie", "--local", "--persist-to", state, "--file", seedFile, "--yes"]));

const dev = spawn("npx", ["--yes", "wrangler@4.155.0", "dev", "--local", "--ip", "127.0.0.1", "--port", String(PORT), "--persist-to", state,
  "--env-file", envFile, "--assets", assets, "--infer-origin-from-routes=false", "--show-interactive-dev-session=false"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
let devLog = "";
dev.stdout.on("data", (d) => (devLog += d)); dev.stderr.on("data", (d) => (devLog += d));
for (let i = 0; i < 120 && !/Ready on/.test(devLog); i++) await new Promise((r) => setTimeout(r, 500));

/* ---------- browse ---------- */
const report = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
try {
  const WIDTHS = [390, 768, 1024, 1440];
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 800 ? 844 : 900 }, bypassCSP: true, colorScheme: "dark", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "/admin/login");
    await page.screenshot({ path: join(OUT, `dashboard-login-${width}.png`) });
    await page.fill("input[name=email]", ADMIN);
    await page.fill("input[name=password]", PASSWORD);
    await page.click("#loginBtn");
    await page.waitForURL(BASE + "/admin/");
    await page.waitForSelector(".card-v");

    const firstEnquiry = await page.evaluate(async () => (await (await fetch("/api/admin/enquiries?per=5")).json()).rows[0].id);
    const firstContact = await page.evaluate(async () => (await (await fetch("/api/admin/contacts?per=5")).json()).rows[0].id);
    const routes = [["overview", "#/overview"], ["analytics", "#/analytics"], ["enquiries", "#/enquiries"], ["enquiry", "#/enquiries/" + firstEnquiry],
      ["contacts", "#/contacts"], ["contact", "#/contacts/" + firstContact], ["settings", "#/settings"]];
    for (const [name, hash] of routes) {
      await page.goto(BASE + "/admin/" + hash);
      await page.waitForFunction(() => !document.querySelector("#main .loading"));
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: join(OUT, `dashboard-${name}-${width}.png`), fullPage: true });
      let axe = null;
      if (width === 1440 || width === 390) {
        await page.evaluate(AXE);
        axe = await page.evaluate(async () => {
          const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
          return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0] && v.nodes[0].target.join(" ") }));
        });
      }
      report.push({ width, page: name, overflow, axe });
      console.log(`${width}px ${name.padEnd(10)} overflow=${overflow}px${axe ? " axe=" + (axe.length ? JSON.stringify(axe) : "clean") : ""}`);
    }
    if (width === 390) {
      await page.click("#menuBtn");
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(OUT, "dashboard-menu-390.png") });
      const focused = await page.evaluate(() => document.activeElement && document.activeElement.closest("#side") !== null);
      await page.keyboard.press("Escape");
      const closed = await page.evaluate(() => !document.querySelector("#side").classList.contains("open"));
      console.log(`390px menu: focus moves into menu=${focused}, Escape closes=${closed}`);
      report.push({ width, page: "menu", focused, closed });
    }
    // keyboard: first Tab lands on the skip link
    await page.goto(BASE + "/admin/#/overview");
    await page.reload(); // a fresh load, not a same-page hash change
    await page.waitForSelector(".card-v");
    await page.keyboard.press("Tab");
    const skip = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
    report.push({ width, page: "keyboard", firstTab: skip });
    console.log(`${width}px first Tab focuses: ${skip}; console errors: ${errors.length ? errors.join(" | ") : "none"}`);
    report.push({ width, page: "console", errors });
    await ctx.close();
  }
} finally {
  await browser.close();
  dev.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 500));
  rmSync(tmp, { recursive: true, force: true });
}
writeFileSync(join(OUT, "dashboard-qa.json"), JSON.stringify(report, null, 2));
const problems = report.filter((r) => r.overflow > 0 || (r.axe && r.axe.length) || (r.errors && r.errors.length) || r.focused === false || r.closed === false);
console.log(problems.length ? `\n${problems.length} problem(s) — see docs/qa/dashboard-qa.json` : "\nNo overflow, no console errors, no axe violations.");
process.exit(problems.length ? 1 : 0);
