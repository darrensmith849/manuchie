// Local, throwaway copy of the dashboard with clearly fake sample data, for offscreen screenshots.
// No browser involved. Prints READY when wrangler dev is up; keeps running until killed.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
const ROOT = "/Users/danieljenkins/manuchie";
const OUT = process.argv[2];
const PORT = 8796;
const ADMIN = "admin@example.test";
const PASSWORD = randomBytes(18).toString("base64url");
const tmp = mkdtempSync(join(tmpdir(), "manuchie-shots-"));
const state = join(tmp, "state");
cpSync(join(ROOT, "dist"), join(tmp, "dist"), { recursive: true });
writeFileSync(join(tmp, "e.env"), "SEND_ACKNOWLEDGEMENT=false\n");
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

/* studio sample data: projects, to-dos, money (fake) */
const dayOff = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
const nowS = new Date().toISOString();
const cidOf = (email) => `(SELECT id FROM contacts WHERE email_norm = ${q(email)})`;
const projects = [
  ["Live worship album", "Production", "in_progress", 55, -40, 9, 450000, "tariro.moyo@example.test", "Choir of 40. Recording at the church on two nights; overdubs at the studio.", ["Pre-production meeting", "Arrangements for 10 songs", "Record live nights", "Overdubs: keys and BVs", "Mix", "Master"], 3],
  ["Debut gospel EP", "Production", "review", 85, -60, 3, 280000, "daniel.okafor@example.test", "4 tracks. Vocals written; needs arrangements, keys and mixing.", ["Arrangements", "Record keys", "Vocal production", "Mix 4 songs", "Master and deliver"], 4],
  ["Easter conference — music direction", "Music direction", "booked", 10, -5, 24, 150000, "hope.city.church@example.test", "3 nights, band of 9. Rehearsals the week before.", ["Set list from pastor", "Charts for the band", "Rehearsal 1", "Rehearsal 2"], 0],
  ["Single: Do you work remotely?", "Keys session", "lead", 0, 0, null, 60000, "lerato.dube@example.test", "Keys session for her single — waiting on stems.", [], 0],
  ["Worship team sound workshop", "Arrangement", "completed", 100, -90, -20, 120000, "grace.fellowship.worship@example.test", "Two-day workshop with the team. Great feedback.", ["Plan sessions", "Day 1", "Day 2"], 3],
  ["Label production — two artists", "Production", "on_hold", 20, -30, 60, 600000, "sample.label.ltd@example.test", "Paused until the label confirms budget for next year.", ["Discovery calls", "Demo for artist 1"], 1],
];
let pn = 0;
for (const [title, type, status, progress, startOff, dueOff, fee, email, notes, tasks, done] of projects) {
  const pid = uuid();
  sql.push(`INSERT INTO projects (id, contact_id, title, type, status, progress, start_date, due_date, completed_at, fee_cents, notes, created_at, updated_at) VALUES (${[pid].map(q).join(",")}, ${cidOf(email)}, ${[title, type, status, progress, dayOff(startOff), dueOff === null ? null : dayOff(dueOff), status === "completed" ? nowS : null, fee, notes, nowS, nowS].map(q).join(",")});`);
  tasks.forEach((t, i) => sql.push(`INSERT INTO project_tasks (id, project_id, title, done, position, created_at) VALUES (${[uuid(), pid, t, i < done ? 1 : 0, i + 1, nowS].map(q).join(",")});`));
  if (status !== "lead") {
    sql.push(`INSERT INTO transactions (id, project_id, kind, amount_cents, date, settled, category, description, created_at, updated_at) VALUES (${[uuid(), pid, "income", Math.round(fee / 2), dayOff(startOff + 2), 1, "Deposit", "50% deposit", nowS, nowS].map(q).join(",")});`);
    sql.push(`INSERT INTO transactions (id, project_id, kind, amount_cents, date, settled, category, description, created_at, updated_at) VALUES (${[uuid(), pid, "income", fee - Math.round(fee / 2), status === "completed" ? dayOff(-15) : dayOff((dueOff || 30) + 7), status === "completed" ? 1 : 0, "Final payment", "Balance on delivery", nowS, nowS].map(q).join(",")});`);
  }
  pn++;
}
const expenses = [["Studio hire", 35000, -3, "Live room, Saturday"], ["Musicians & vocalists", 60000, -8, "Session drummer and bass"], ["Mixing & mastering", 25000, -35, "Mastering engineer"],
  ["Software & plugins", 18000, -50, "Plugin bundle renewal"], ["Equipment", 89000, -120, "New monitors"], ["Travel", 22000, -12, "Fuel and tolls to Bulawayo"], ["Musicians & vocalists", 40000, -70, "BV singers"], ["Studio hire", 30000, 6, "Rehearsal room (booked)"]];
for (const [cat, amt, off, desc] of expenses) sql.push(`INSERT INTO transactions (id, project_id, kind, amount_cents, date, settled, category, description, created_at, updated_at) VALUES (${[uuid(), null, "expense", amt, dayOff(off), off > 0 ? 0 : 1, cat, desc, nowS, nowS].map(q).join(",")});`);
for (const [amt, off, desc] of [[42000, -150, "Royalties: streaming"], [65000, -100, "Performance fee: wedding"], [30000, -200, "Royalties: sync"]]) sql.push(`INSERT INTO transactions (id, project_id, kind, amount_cents, date, settled, category, description, created_at, updated_at) VALUES (${[uuid(), null, "income", amt, dayOff(off), 1, off < -120 ? "Royalties" : "Performance", desc, nowS, nowS].map(q).join(",")});`);
sql.push(`UPDATE contacts SET phone = '+263 77 412 0098', company = 'Harare Community Choir' WHERE email_norm = 'tariro.moyo@example.test';`);
sql.push(`UPDATE contacts SET phone = '+61 412 555 019' WHERE email_norm = 'daniel.okafor@example.test';`);
/* invoices (fake) */
const yr = dayOff(0).slice(0, 4);
sql.push(`INSERT INTO settings (key, value, created_at) VALUES ('business', ${q(JSON.stringify({ email: "studio@example.test", phone: "+263 77 000 0000", bank: "Sample Bank Zimbabwe\nAccount name: Manuchie Music\nAccount number: 0000 1234 5678\nBranch: Harare Central", tax_label: "VAT", tax_number: "10023456", tax_bp: 1500, due_days: 14 }))}, ${q(nowS)});`);
sql.push(`INSERT INTO settings (key, value, created_at) VALUES ('invoice_seq', ${q(yr + ":4")}, ${q(nowS)});`);
const pidOf = (title) => `(SELECT id FROM projects WHERE title = ${q(title)})`;
const invoices = [
  ["001", "paid", -30, -16, "grace.fellowship.worship@example.test", "Grace Fellowship Worship", "Grace Fellowship Church", "Worship team sound workshop", [["Sound workshop — two days with the worship team", 2, 60000]], 0, 0, -20],
  ["002", "sent", -20, -6, "daniel.okafor@example.test", "Daniel Okafor", "", "Debut gospel EP", [["Arrangements — 4 songs", 4, 15000], ["Keys recording", 1, 30000], ["Mixing — 4 songs", 4, 12500]], 0, 1500, null],
  ["003", "sent", -3, 11, "tariro.moyo@example.test", "Tariro Moyo", "Harare Community Choir", "Live worship album", [["Live album production — stage 2 (recording nights)", 1, 180000], ["Overdubs: keys and backing vocals", 1, 45000]], 10000, 1500, null],
  ["004", "draft", 0, 14, "hope.city.church@example.test", "Hope City Church", "Hope City Church", "Easter conference — music direction", [["Music direction — conference night", 3, 40000], ["Band rehearsal", 2, 15000]], 0, 1500, null],
];
for (const [num, status, issue, due, email, name, company, project, items, discount, tax, paid] of invoices) {
  const iid = uuid();
  let txId = null;
  if (paid !== null) {
    txId = uuid();
    const total = items.reduce((a, [, qn, u]) => a + qn * u, 0);
    sql.push(`INSERT INTO transactions (id, project_id, kind, amount_cents, date, settled, category, description, created_at, updated_at) VALUES (${q(txId)}, ${pidOf(project)}, 'income', ${total}, ${q(dayOff(paid))}, 1, 'Invoice', ${q(`Invoice MAN-${yr}-${num}`)}, ${q(nowS)}, ${q(nowS)});`);
  }
  sql.push(`INSERT INTO invoices (id, number, project_id, contact_id, status, issue_date, due_date, currency, client_name, client_company, client_email, client_phone, client_address, items, discount_cents, tax_bp, tax_label, notes, share_token, transaction_id, sent_at, paid_at, created_at, updated_at) VALUES (${q(iid)}, ${q(`MAN-${yr}-${num}`)}, ${pidOf(project)}, ${cidOf(email)}, ${[status, dayOff(issue), dayOff(due), "USD", name, company, email, "", "Harare, Zimbabwe", JSON.stringify(items.map(([description, qty, unit_cents]) => ({ description, qty, unit_cents }))), discount, tax, "VAT", status === "draft" ? "" : "Thank you for trusting me with your music.", null, txId, status === "draft" ? null : dayOff(issue) + "T09:00:00.000Z", paid === null ? null : dayOff(paid) + "T12:00:00.000Z", nowS, nowS].map(q).join(",")});`);
}
const seedFile = join(tmp, "seed.sql");
writeFileSync(seedFile, sql.join("\n"));
must(wr(["d1", "execute", "manuchie", "--local", "--persist-to", state, "--file", seedFile, "--yes"]));
writeFileSync(join(OUT, "login.json"), JSON.stringify({ email: ADMIN, password: PASSWORD }), { mode: 0o600 });
const dev = spawn("npx", ["--yes", "wrangler@4.155.0", "dev", "--local", "--local-protocol", "https", "--ip", "127.0.0.1", "--port", String(PORT), "--persist-to", state,
  "--env-file", join(tmp, "e.env"), "--assets", join(tmp, "dist"), "--infer-origin-from-routes=false", "--show-interactive-dev-session=false"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
dev.stdout.on("data", (d) => { log += d; if (/Ready on/.test(log) && !log.includes("@@")) { log += "@@"; console.log("READY https://127.0.0.1:" + PORT); } });
dev.stderr.on("data", (d) => (log += d));
const stop = () => { dev.kill("SIGINT"); setTimeout(() => { rmSync(tmp, { recursive: true, force: true }); process.exit(0); }, 600); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
