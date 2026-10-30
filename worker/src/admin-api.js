/* /api/admin/* — JSON for the private dashboard. Every route here runs after requireAdmin(). */

import { json, csv, readBody, PRIVATE_HEADERS } from "./lib/http.js";
import { clean, normEmail, isEmail, parseTags, parseRange, daysBetween, toCsv } from "./lib/text.js";
import { newId } from "./lib/crypto.js";
import { changePassword } from "./auth.js";
import { emailConfigured, ackEnabled } from "./email.js";
import { CONSENT_WORDING } from "./enquiry.js";
import { handleStudioApi, studioSummary, getCurrency } from "./studio-api.js";

export const STATUSES = ["new", "read", "replied", "in_progress", "booked", "closed", "spam"];
const PLATFORMS = ["spotify", "apple_music", "youtube", "shazam", "instagram", "email", "book_session"];
const SOURCE_SQL = "COALESCE(utm_source, ref_host, 'Direct')";
// Grouped queries alias their label as "name", which is also a column of `events`; SQLite would
// group by the column, so those queries use GROUP BY 1 (the first selected expression).

const all = async (stmt) => (await stmt.all()).results || [];
const like = (q) => "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
const page = (params) => {
  const per = Math.min(100, Math.max(5, Number(params.get("per")) || 25));
  const p = Math.max(1, Number(params.get("page")) || 1);
  return { per, page: p, offset: (p - 1) * per };
};
const nowIso = () => new Date().toISOString();
const stamp = () => nowIso().slice(0, 10);

/* ---------- analytics ---------- */

async function totals(env, from, to) {
  const [views, clicks, starts, enquiries] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS pageviews, COUNT(DISTINCT session) AS visits, COUNT(DISTINCT visitor) AS visitors
                    FROM events WHERE type = 'pageview' AND day BETWEEN ? AND ?`).bind(from, to),
    env.DB.prepare(`SELECT name, COUNT(*) AS n FROM events WHERE type = 'click' AND day BETWEEN ? AND ? GROUP BY name`).bind(from, to),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM events WHERE type = 'form_start' AND day BETWEEN ? AND ?`).bind(from, to),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM enquiries WHERE status != 'spam' AND substr(created_at, 1, 10) BETWEEN ? AND ?`).bind(from, to),
  ]);
  const v = views.results[0];
  const byName = Object.fromEntries(clicks.results.map((r) => [r.name, r.n]));
  const out = {
    pageviews: v.pageviews, visits: v.visits, visitors: v.visitors,
    form_starts: starts.results[0].n, enquiries: enquiries.results[0].n,
    clicks: Object.fromEntries(PLATFORMS.map((p) => [p, byName[p] || 0])),
  };
  out.conversion = out.visits ? out.enquiries / out.visits : 0;
  return out;
}

async function series(env, from, to) {
  const [views, enq] = await env.DB.batch([
    env.DB.prepare(`SELECT day, COUNT(*) AS pageviews, COUNT(DISTINCT session) AS visits, COUNT(DISTINCT visitor) AS visitors
                    FROM events WHERE type = 'pageview' AND day BETWEEN ? AND ? GROUP BY day`).bind(from, to),
    env.DB.prepare(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS enquiries FROM enquiries
                    WHERE status != 'spam' AND substr(created_at, 1, 10) BETWEEN ? AND ? GROUP BY day`).bind(from, to),
  ]);
  const v = Object.fromEntries(views.results.map((r) => [r.day, r]));
  const e = Object.fromEntries(enq.results.map((r) => [r.day, r.enquiries]));
  return daysBetween(from, to).map((day) => ({
    day, pageviews: v[day]?.pageviews || 0, visits: v[day]?.visits || 0, visitors: v[day]?.visitors || 0, enquiries: e[day] || 0,
  }));
}

const ranked = (env, sql, from, to, limit = 10) => all(env.DB.prepare(sql + ` LIMIT ${limit}`).bind(from, to));

async function overview(env, params) {
  const r = parseRange(params);
  const [current, previous, daily, previousSeries, sections, sources, unread, recent] = await Promise.all([
    totals(env, r.from, r.to),
    totals(env, r.prevFrom, r.prevTo),
    series(env, r.from, r.to),
    series(env, r.prevFrom, r.prevTo),
    ranked(env, `SELECT name, COUNT(*) AS n FROM events WHERE type = 'section_view' AND day BETWEEN ? AND ? GROUP BY name ORDER BY n DESC`, r.from, r.to),
    ranked(env, `SELECT ${SOURCE_SQL} AS name, COUNT(DISTINCT session) AS n FROM events WHERE type = 'pageview' AND day BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC`, r.from, r.to, 6),
    all(env.DB.prepare("SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status")),
    all(env.DB.prepare(`SELECT id, name, email, status, created_at, substr(message, 1, 120) AS preview, last_contacted_at FROM enquiries
                        WHERE status IN ('new', 'read', 'replied', 'in_progress') ORDER BY created_at DESC LIMIT 8`)),
  ]);
  const statusCounts = Object.fromEntries(unread.map((c) => [c.status, c.n]));
  const studio = await studioSummary(env);
  return json({ range: r, current, previous, series: daily, previousSeries, sections, sources, unread: statusCounts.new || 0, statusCounts, recent, studio });
}

async function analytics(env, params) {
  const r = parseRange(params);
  const q = (sql, limit) => ranked(env, sql, r.from, r.to, limit);
  const [current, previous, daily, previousSeries, pages, sources, campaigns, devices, countries, sections, contactViews] = await Promise.all([
    totals(env, r.from, r.to),
    totals(env, r.prevFrom, r.prevTo),
    series(env, r.from, r.to),
    series(env, r.prevFrom, r.prevTo),
    q(`SELECT path AS name, COUNT(*) AS n, COUNT(DISTINCT visitor) AS visitors FROM events WHERE type = 'pageview' AND day BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC`, 10),
    q(`SELECT ${SOURCE_SQL} AS name, COUNT(DISTINCT session) AS n FROM events WHERE type = 'pageview' AND day BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC`, 12),
    q(`SELECT utm_source AS source, COALESCE(utm_medium, '') AS medium, COALESCE(utm_campaign, '') AS campaign, COUNT(DISTINCT session) AS n
       FROM events WHERE type = 'pageview' AND utm_source IS NOT NULL AND day BETWEEN ? AND ? GROUP BY source, medium, campaign ORDER BY n DESC`, 12),
    q(`SELECT COALESCE(device, 'unknown') AS name, COUNT(DISTINCT session) AS n FROM events WHERE type = 'pageview' AND day BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC`, 5),
    q(`SELECT COALESCE(country, 'Unknown') AS name, COUNT(DISTINCT session) AS n FROM events WHERE type = 'pageview' AND day BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC`, 12),
    q(`SELECT name, COUNT(*) AS n FROM events WHERE type = 'section_view' AND day BETWEEN ? AND ? GROUP BY name ORDER BY n DESC`, 10),
    q(`SELECT COUNT(DISTINCT session) AS n FROM events WHERE type = 'section_view' AND name = 'contact' AND day BETWEEN ? AND ?`, 1),
  ]);
  const funnel = { visits: current.visits, saw_contact: contactViews[0]?.n || 0, form_starts: current.form_starts, enquiries: current.enquiries };
  return json({ range: r, current, previous, series: daily, previousSeries, pages, sources, campaigns, devices, countries, sections, funnel });
}

/* ---------- enquiries ---------- */

function enquiryFilters(params) {
  const where = [];
  const binds = [];
  const q = clean(params.get("q"), 100);
  const status = params.get("status") || "";
  const wanted = status.split(",").filter((x) => STATUSES.includes(x));
  if (q) { where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')"); binds.push(like(q), like(q), like(q)); }
  if (wanted.length) { where.push(`status IN (${wanted.map(() => "?").join(",")})`); binds.push(...wanted); }
  else if (status !== "all") where.push("status != 'spam'");
  const from = params.get("from"), to = params.get("to");
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || "")) { where.push("substr(created_at, 1, 10) >= ?"); binds.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || "")) { where.push("substr(created_at, 1, 10) <= ?"); binds.push(to); }
  const ids = (params.get("ids") || "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/.test(s)).slice(0, 500);
  if (ids.length) { where.length = 0; binds.length = 0; where.push(`id IN (${ids.map(() => "?").join(",")})`); binds.push(...ids); }
  return { sql: where.length ? "WHERE " + where.join(" AND ") : "", binds };
}

async function listEnquiries(env, params) {
  const f = enquiryFilters(params);
  const pg = page(params);
  const [rows, total, counts] = await Promise.all([
    all(env.DB.prepare(`SELECT id, name, email, substr(message, 1, 140) AS preview, length(message) > 140 AS truncated,
                          created_at, status, marketing_consent, email_status, last_contacted_at, notes != '' AS has_notes
                        FROM enquiries ${f.sql} ORDER BY created_at ${params.get("sort") === "oldest" ? "ASC" : "DESC"} LIMIT ? OFFSET ?`).bind(...f.binds, pg.per, pg.offset)),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM enquiries ${f.sql}`).bind(...f.binds).first(),
    all(env.DB.prepare("SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status")),
  ]);
  return json({ rows, total: total.n, page: pg.page, per: pg.per, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) });
}

async function getEnquiry(env, id) {
  let row = await env.DB.prepare("SELECT * FROM enquiries WHERE id = ?").bind(id).first();
  if (!row) return json({ ok: false, error: "not_found" }, 404);
  if (row.status === "new") {
    await env.DB.prepare("UPDATE enquiries SET status = 'read', updated_at = ? WHERE id = ?").bind(nowIso(), id).run();
    row = { ...row, status: "read" };
  }
  const contact = row.contact_id
    ? await env.DB.prepare(`SELECT id, status, marketing_consent, consent_at, unsubscribed_at, tags,
                              (SELECT COUNT(*) FROM enquiries WHERE contact_id = contacts.id) AS enquiry_count
                            FROM contacts WHERE id = ?`).bind(row.contact_id).first()
    : null;
  const others = row.contact_id
    ? await all(env.DB.prepare(`SELECT id, created_at, status, substr(message, 1, 100) AS preview FROM enquiries
                                WHERE contact_id = ? AND id != ? ORDER BY created_at DESC LIMIT 10`).bind(row.contact_id, id))
    : [];
  return json({ enquiry: row, contact: contact && { ...contact, tags: JSON.parse(contact.tags || "[]") }, others });
}

/* Links an enquiry that was flagged as spam to a contact once a person marks it as genuine. */
async function linkContact(env, e) {
  const now = nowIso();
  const emailNorm = normEmail(e.email);
  let contact = await env.DB.prepare("SELECT id FROM contacts WHERE email_norm = ?").bind(emailNorm).first();
  const stmts = [];
  const contactId = contact ? contact.id : newId();
  if (!contact) {
    stmts.push(env.DB.prepare("INSERT INTO contacts (id, email, email_norm, name, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(contactId, e.email, emailNorm, e.name, e.created_at, now, e.utm_source || "direct"));
  }
  stmts.push(env.DB.prepare("UPDATE enquiries SET contact_id = ?, spam_reason = NULL WHERE id = ?").bind(contactId, e.id));
  if (e.marketing_consent) {
    stmts.push(env.DB.prepare(`INSERT INTO consent_records (id, contact_id, enquiry_id, action, wording, method, source_page, created_at)
                               VALUES (?, ?, ?, 'granted', ?, 'website form', ?, ?)`)
      .bind(newId(), contactId, e.id, CONSENT_WORDING, e.source_page, e.created_at));
    stmts.push(env.DB.prepare("UPDATE contacts SET marketing_consent = 1, consent_at = ? WHERE id = ? AND unsubscribed_at IS NULL")
      .bind(e.created_at, contactId));
  }
  await env.DB.batch(stmts);
}

async function updateEnquiry(env, id, request) {
  const e = await env.DB.prepare("SELECT * FROM enquiries WHERE id = ?").bind(id).first();
  if (!e) return json({ ok: false, error: "not_found" }, 404);
  const { data = {} } = await readBody(request, 10000);
  const now = nowIso();
  const sets = ["updated_at = ?"];
  const binds = [now];
  let status = e.status;
  if (data.status !== undefined) {
    if (!STATUSES.includes(data.status)) return json({ ok: false, error: "status" }, 400);
    status = data.status;
  }
  if (data.replied === true) {
    if (!["booked", "in_progress", "closed"].includes(status)) status = "replied";
    sets.push("last_contacted_at = ?"); binds.push(now);
  }
  if (status !== e.status) { sets.push("status = ?"); binds.push(status); }
  if (data.notes !== undefined) { sets.push("notes = ?"); binds.push(clean(data.notes, 5000, { multiline: true })); }
  let name = e.name, email = e.email;
  if (data.name !== undefined) {
    name = clean(data.name, 120);
    if (!name) return json({ ok: false, error: "name", message: "Enter a name." }, 400);
    sets.push("name = ?"); binds.push(name);
  }
  if (data.email !== undefined) {
    email = clean(data.email, 254);
    if (!isEmail(email)) return json({ ok: false, error: "email", message: "Enter a valid email address." }, 400);
    sets.push("email = ?"); binds.push(email);
  }

  await env.DB.prepare(`UPDATE enquiries SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();
  if (e.contact_id && (name !== e.name || email !== e.email)) await syncContact(env, e.contact_id, id, name, email, now);
  if (e.status === "spam" && status !== "spam" && !e.contact_id) await linkContact(env, e);
  const contactId = e.contact_id || (await env.DB.prepare("SELECT contact_id FROM enquiries WHERE id = ?").bind(id).first()).contact_id;
  if (data.replied === true && contactId) {
    await env.DB.prepare("UPDATE contacts SET last_contacted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, contactId).run();
  }
  return getEnquiry(env, id);
}

/* After a name/email correction on an enquiry: update its contact, or move the enquiry (and any
   consent proof) to the contact that already has the corrected address. */
async function syncContact(env, contactId, enquiryId, name, email, now) {
  const norm = normEmail(email);
  const other = await env.DB.prepare("SELECT id FROM contacts WHERE email_norm = ? AND id != ?").bind(norm, contactId).first();
  if (!other) {
    await env.DB.prepare("UPDATE contacts SET name = ?, email = ?, email_norm = ?, updated_at = ? WHERE id = ?")
      .bind(name, email, norm, now, contactId).run();
    return;
  }
  const rest = await env.DB.prepare("SELECT COUNT(*) AS n FROM enquiries WHERE contact_id = ? AND id != ?").bind(contactId, enquiryId).first();
  const stmts = [env.DB.prepare("UPDATE enquiries SET contact_id = ? WHERE id = ?").bind(other.id, enquiryId)];
  if (!rest.n) {
    stmts.push(env.DB.prepare("UPDATE consent_records SET contact_id = ? WHERE contact_id = ?").bind(other.id, contactId));
    stmts.push(env.DB.prepare(`UPDATE contacts SET marketing_consent = MAX(marketing_consent, (SELECT marketing_consent FROM contacts WHERE id = ?)),
                                 consent_at = COALESCE(consent_at, (SELECT consent_at FROM contacts WHERE id = ?)), updated_at = ? WHERE id = ?`)
      .bind(contactId, contactId, now, other.id));
    stmts.push(env.DB.prepare("DELETE FROM contacts WHERE id = ?").bind(contactId));
  }
  await env.DB.batch(stmts);
}

/* Several enquiries at once: { ids: [...], status } or { ids: [...], delete: true }. */
async function bulkEnquiries(env, request) {
  const { data = {} } = await readBody(request, 40000);
  const ids = (Array.isArray(data.ids) ? data.ids : []).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 500);
  if (!ids.length) return json({ ok: false, error: "ids" }, 400);
  const marks = ids.map(() => "?").join(",");
  if (data.delete === true) {
    const r = await env.DB.prepare(`DELETE FROM enquiries WHERE id IN (${marks})`).bind(...ids).run();
    return json({ ok: true, changed: r.meta.changes });
  }
  if (!STATUSES.includes(data.status)) return json({ ok: false, error: "status" }, 400);
  const unspam = data.status !== "spam"
    ? await all(env.DB.prepare(`SELECT * FROM enquiries WHERE id IN (${marks}) AND status = 'spam' AND contact_id IS NULL`).bind(...ids))
    : [];
  const r = await env.DB.prepare(`UPDATE enquiries SET status = ?, updated_at = ? WHERE id IN (${marks})`).bind(data.status, nowIso(), ...ids).run();
  for (const e of unspam) await linkContact(env, e);
  return json({ ok: true, changed: r.meta.changes });
}

async function deleteEnquiry(env, id) {
  const r = await env.DB.prepare("DELETE FROM enquiries WHERE id = ?").bind(id).run();
  return r.meta.changes ? json({ ok: true }) : json({ ok: false, error: "not_found" }, 404);
}

async function exportEnquiries(env, params) {
  const f = enquiryFilters(params);
  const rows = await all(env.DB.prepare(`SELECT * FROM enquiries ${f.sql} ORDER BY created_at DESC LIMIT 10000`).bind(...f.binds));
  return csv(`manuchie-enquiries-${stamp()}.csv`, toCsv(rows, [
    { label: "ID", key: "id" }, { label: "Received (UTC)", key: "created_at" }, { label: "Name", key: "name" },
    { label: "Email", key: "email" }, { label: "Status", key: "status" },
    { label: "Marketing consent", value: (r) => (r.marketing_consent ? "yes" : "no") },
    { label: "Source page", key: "source_page" }, { label: "Referrer", key: "referrer" },
    { label: "UTM source", key: "utm_source" }, { label: "UTM medium", key: "utm_medium" }, { label: "UTM campaign", key: "utm_campaign" },
    { label: "Last contacted (UTC)", key: "last_contacted_at" }, { label: "Email delivery", key: "email_status" },
    { label: "Notes", key: "notes" }, { label: "Message", key: "message" },
  ]));
}

/* ---------- contacts ---------- */

const CONTACT_SORT = { created: "c.created_at", name: "c.name COLLATE NOCASE", enquiries: "enquiry_count", latest: "latest_enquiry" };

function contactFilters(params) {
  const where = [];
  const binds = [];
  const q = clean(params.get("q"), 100);
  if (q) { where.push("(c.name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR c.notes LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.company LIKE ? ESCAPE '\\')"); binds.push(like(q), like(q), like(q), like(q), like(q)); }
  const consent = params.get("consent");
  if (consent === "yes") where.push("c.marketing_consent = 1 AND c.status = 'active' AND c.unsubscribed_at IS NULL");
  if (consent === "no") where.push("c.marketing_consent = 0");
  if (consent === "withdrawn") where.push("c.unsubscribed_at IS NOT NULL");
  if (["active", "suppressed"].includes(params.get("status"))) { where.push("c.status = ?"); binds.push(params.get("status")); }
  const tag = clean(params.get("tag"), 40).toLowerCase();
  if (tag) { where.push("EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value = ?)"); binds.push(tag); }
  return { sql: where.length ? "WHERE " + where.join(" AND ") : "", binds };
}

const CONTACT_SELECT = `SELECT c.*, COUNT(e.id) AS enquiry_count, MAX(e.created_at) AS latest_enquiry,
  (SELECT status FROM enquiries WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1) AS latest_status
  FROM contacts c LEFT JOIN enquiries e ON e.contact_id = c.id`;

const tidyContact = (c) => ({ ...c, tags: JSON.parse(c.tags || "[]") });

async function listContacts(env, params) {
  const f = contactFilters(params);
  const pg = page(params);
  const sort = CONTACT_SORT[params.get("sort")] || CONTACT_SORT.latest;
  const dir = params.get("dir") === "asc" ? "ASC" : "DESC";
  const [rows, total, tags] = await Promise.all([
    all(env.DB.prepare(`${CONTACT_SELECT} ${f.sql} GROUP BY c.id ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`).bind(...f.binds, pg.per, pg.offset)),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM contacts c ${f.sql}`).bind(...f.binds).first(),
    all(env.DB.prepare("SELECT json_each.value AS tag, COUNT(*) AS n FROM contacts, json_each(contacts.tags) GROUP BY tag ORDER BY n DESC LIMIT 50")),
  ]);
  return json({ rows: rows.map(tidyContact), total: total.n, page: pg.page, per: pg.per, tags });
}

async function getContact(env, id) {
  const c = await env.DB.prepare(`${CONTACT_SELECT} WHERE c.id = ? GROUP BY c.id`).bind(id).first();
  if (!c) return json({ ok: false, error: "not_found" }, 404);
  const [enquiries, consent, projects] = await Promise.all([
    all(env.DB.prepare(`SELECT id, created_at, status, substr(message, 1, 140) AS preview, marketing_consent
                        FROM enquiries WHERE contact_id = ? ORDER BY created_at DESC`).bind(id)),
    all(env.DB.prepare("SELECT id, action, wording, method, source_page, created_at FROM consent_records WHERE contact_id = ? ORDER BY created_at DESC").bind(id)),
    all(env.DB.prepare(`SELECT p.id, p.title, p.status, p.progress, p.due_date, p.fee_cents,
                          (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions x WHERE x.project_id = p.id AND x.kind = 'income' AND x.settled = 1) AS received_cents
                        FROM projects p WHERE p.contact_id = ? ORDER BY p.updated_at DESC`).bind(id)),
  ]);
  return json({ contact: tidyContact(c), enquiries, consent, projects });
}

async function updateContact(env, id, request) {
  const c = await env.DB.prepare("SELECT * FROM contacts WHERE id = ?").bind(id).first();
  if (!c) return json({ ok: false, error: "not_found" }, 404);
  const { data = {} } = await readBody(request, 10000);
  const now = nowIso();
  const stmts = [];
  const sets = ["updated_at = ?"];
  const binds = [now];
  if (data.notes !== undefined) { sets.push("notes = ?"); binds.push(clean(data.notes, 5000, { multiline: true })); }
  if (data.tags !== undefined) { sets.push("tags = ?"); binds.push(JSON.stringify(parseTags(data.tags))); }
  if (data.name !== undefined) {
    const name = clean(data.name, 120);
    if (!name) return json({ ok: false, error: "name", message: "Enter a name." }, 400);
    sets.push("name = ?"); binds.push(name);
  }
  if (data.email !== undefined) {
    const email = clean(data.email, 254);
    if (email && !isEmail(email)) return json({ ok: false, error: "email", message: "Enter a valid email address." }, 400);
    const taken = email && await env.DB.prepare("SELECT id FROM contacts WHERE email_norm = ? AND id != ?").bind(normEmail(email), id).first();
    if (taken) return json({ ok: false, error: "email_taken", message: "Another contact already has that email address." }, 409);
    sets.push("email = ?", "email_norm = ?"); binds.push(email, email ? normEmail(email) : "none:" + id);
  }
  if (data.phone !== undefined) { sets.push("phone = ?"); binds.push(clean(data.phone, 40)); }
  if (data.company !== undefined) { sets.push("company = ?"); binds.push(clean(data.company, 120)); }
  if (data.suppressed !== undefined) { sets.push("status = ?"); binds.push(data.suppressed ? "suppressed" : "active"); }
  if (data.unsubscribe === true && c.marketing_consent) {
    sets.push("marketing_consent = 0", "unsubscribed_at = ?"); binds.push(now);
    stmts.push(env.DB.prepare(`INSERT INTO consent_records (id, contact_id, action, wording, method, created_at)
                               VALUES (?, ?, 'withdrawn', ?, 'dashboard', ?)`)
      .bind(newId(), id, clean(data.reason, 300) || "Unsubscribed — recorded in the dashboard", now));
  }
  stmts.unshift(env.DB.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id));
  await env.DB.batch(stmts);
  return getContact(env, id);
}

/* Right to erasure: removes the contact, every enquiry they sent and their consent history. */
async function deleteContact(env, id) {
  const [, , r] = await env.DB.batch([
    env.DB.prepare("DELETE FROM consent_records WHERE contact_id = ?").bind(id),
    env.DB.prepare("DELETE FROM enquiries WHERE contact_id = ?").bind(id),
    env.DB.prepare("DELETE FROM contacts WHERE id = ?").bind(id),
  ]);
  return r.meta.changes ? json({ ok: true }) : json({ ok: false, error: "not_found" }, 404);
}

/* Right of access: everything held about one person, as a JSON download. */
async function exportContact(env, id) {
  const contact = await env.DB.prepare("SELECT * FROM contacts WHERE id = ?").bind(id).first();
  if (!contact) return json({ ok: false, error: "not_found" }, 404);
  const [enquiries, consent] = await Promise.all([
    all(env.DB.prepare(`SELECT id, name, email, message, created_at, source_page, referrer, utm_source, utm_medium, utm_campaign,
                          status, marketing_consent, last_contacted_at FROM enquiries WHERE contact_id = ? ORDER BY created_at`).bind(id)),
    all(env.DB.prepare("SELECT action, wording, method, source_page, created_at FROM consent_records WHERE contact_id = ? ORDER BY created_at").bind(id)),
  ]);
  const body = JSON.stringify({ exported_at: nowIso(), contact: tidyContact(contact), enquiries, consent }, null, 2);
  return new Response(body, { headers: { ...PRIVATE_HEADERS, "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="manuchie-contact-${stamp()}.json"` } });
}

async function exportContacts(env, params) {
  const f = contactFilters(params);
  const rows = (await all(env.DB.prepare(`${CONTACT_SELECT} ${f.sql} GROUP BY c.id ORDER BY c.created_at DESC LIMIT 10000`).bind(...f.binds))).map(tidyContact);
  return csv(`manuchie-contacts-${stamp()}.csv`, toCsv(rows, [
    { label: "Name", key: "name" }, { label: "Email", key: "email" }, { label: "Date added (UTC)", key: "created_at" },
    { label: "Enquiries", key: "enquiry_count" }, { label: "Latest enquiry (UTC)", key: "latest_enquiry" },
    { label: "Latest status", key: "latest_status" }, { label: "Contact status", key: "status" },
    { label: "Marketing consent", value: (r) => (r.marketing_consent ? "yes" : "no") },
    { label: "Consent timestamp (UTC)", key: "consent_at" }, { label: "Unsubscribed (UTC)", key: "unsubscribed_at" },
    { label: "Source", key: "source" }, { label: "Tags", value: (r) => r.tags.join("; ") },
    { label: "Last contacted (UTC)", key: "last_contacted_at" }, { label: "Notes", key: "notes" },
  ]));
}

/* ---------- marketing consent ---------- */

async function listConsent(env, params) {
  const q = clean(params.get("q"), 100);
  const action = ["granted", "withdrawn"].includes(params.get("action")) ? params.get("action") : null;
  const where = [];
  const binds = [];
  if (q) { where.push("(c.name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\')"); binds.push(like(q), like(q)); }
  if (action) { where.push("r.action = ?"); binds.push(action); }
  const sql = where.length ? "WHERE " + where.join(" AND ") : "";
  const pg = page(params);
  const [rows, summary] = await Promise.all([
    all(env.DB.prepare(`SELECT r.id, r.action, r.wording, r.method, r.source_page, r.created_at, c.id AS contact_id, c.name, c.email,
                          c.status AS contact_status, c.marketing_consent
                        FROM consent_records r JOIN contacts c ON c.id = r.contact_id ${sql}
                        ORDER BY r.created_at DESC LIMIT ? OFFSET ?`).bind(...binds, pg.per, pg.offset)),
    env.DB.prepare(`SELECT
        SUM(marketing_consent = 1 AND status = 'active' AND unsubscribed_at IS NULL) AS marketable,
        SUM(unsubscribed_at IS NOT NULL) AS withdrawn,
        SUM(status = 'suppressed') AS suppressed,
        COUNT(*) AS contacts FROM contacts`).first(),
  ]);
  return json({ rows, summary, page: pg.page, per: pg.per });
}

/* Clean list for an external email platform: only people who opted in and haven't left. */
async function exportConsent(env) {
  const rows = await all(env.DB.prepare(`SELECT c.name, c.email, c.consent_at, c.source, c.tags,
      (SELECT wording FROM consent_records WHERE contact_id = c.id AND action = 'granted' ORDER BY created_at DESC LIMIT 1) AS wording,
      (SELECT method FROM consent_records WHERE contact_id = c.id AND action = 'granted' ORDER BY created_at DESC LIMIT 1) AS method
    FROM contacts c WHERE c.marketing_consent = 1 AND c.status = 'active' AND c.unsubscribed_at IS NULL ORDER BY c.consent_at`));
  return csv(`manuchie-marketing-consent-${stamp()}.csv`, toCsv(rows.map(tidyContact), [
    { label: "Name", key: "name" }, { label: "Email", key: "email" }, { label: "Consent timestamp (UTC)", key: "consent_at" },
    { label: "Consent method", key: "method" }, { label: "Consent wording", key: "wording" }, { label: "Source", key: "source" },
    { label: "Tags", value: (r) => r.tags.join("; ") },
  ]));
}

/* ---------- settings ---------- */

const mask = (email) => (email ? String(email).replace(/^(.)(.*)(@.*)$/, (m, a, b, c) => a + "•".repeat(Math.min(6, b.length)) + c) : null);

async function settings(env, admin) {
  const [me, sessions, counts] = await Promise.all([
    env.DB.prepare("SELECT email, created_at, last_login_at FROM admins WHERE id = ?").bind(admin.id).first(),
    all(env.DB.prepare("SELECT id, created_at, last_seen_at, expires_at, user_agent FROM sessions WHERE admin_id = ? AND expires_at > ? ORDER BY last_seen_at DESC")
      .bind(admin.id, nowIso())),
    env.DB.prepare(`SELECT (SELECT COUNT(*) FROM enquiries) AS enquiries, (SELECT COUNT(*) FROM contacts) AS contacts,
                      (SELECT COUNT(*) FROM events) AS events, (SELECT MIN(day) FROM events) AS first_event_day`).first(),
  ]);
  return json({
    admin: me,
    email: {
      configured: emailConfigured(env),
      to: mask(env.MAIL_TO),
      from: env.MAIL_FROM || null,
      acknowledgement: ackEnabled(env),
    },
    sessions: sessions.map((s) => ({ ...s, id: undefined, current: s.id === admin.sessionId })),
    counts,
    retention: "Anonymous analytics events are kept for 13 months. Enquiries and contacts are kept until you delete them.",
  });
}

/* ---------- router ---------- */

export async function handleAdminApi(request, env, admin, path) {
  const url = new URL(request.url);
  const p = url.searchParams;
  const m = request.method;
  const parts = path.split("/").filter(Boolean); // e.g. ["enquiries", "<id>"]
  const [resource, id, sub] = parts;
  const uuid = (s) => /^[0-9a-f-]{36}$/.test(s || "");

  const studio = await handleStudioApi(request, env, parts);
  if (studio) return studio;
  if (resource === "me" && m === "GET") return json({ email: admin.email, csrf: admin.csrf, currency: await getCurrency(env) });
  if (resource === "overview" && m === "GET") return overview(env, p);
  if (resource === "analytics" && m === "GET") return analytics(env, p);

  if (resource === "enquiries.csv" && m === "GET") return exportEnquiries(env, p);
  if (resource === "enquiries" && !id && m === "GET") return listEnquiries(env, p);
  if (resource === "enquiries" && id === "bulk" && m === "POST") return bulkEnquiries(env, request);
  if (resource === "enquiries" && uuid(id) && !sub) {
    if (m === "GET") return getEnquiry(env, id);
    if (m === "PATCH") return updateEnquiry(env, id, request);
    if (m === "DELETE") return deleteEnquiry(env, id);
  }

  if (resource === "contacts.csv" && m === "GET") return exportContacts(env, p);
  if (resource === "contacts" && !id && m === "GET") return listContacts(env, p);
  if (resource === "contacts" && uuid(id)) {
    if (sub === "export" && m === "GET") return exportContact(env, id);
    if (!sub && m === "GET") return getContact(env, id);
    if (!sub && m === "PATCH") return updateContact(env, id, request);
    if (!sub && m === "DELETE") return deleteContact(env, id);
  }

  if (resource === "consent.csv" && m === "GET") return exportConsent(env);
  if (resource === "consent" && m === "GET") return listConsent(env, p);

  if (resource === "settings" && !id && m === "GET") return settings(env, admin);
  if (resource === "settings" && id === "password" && m === "POST") {
    const { data = {} } = await readBody(request, 2000);
    const result = await changePassword(env, admin, data.current, data.next);
    return json(result, result.ok ? 200 : 400);
  }
  if (resource === "settings" && id === "sign-out-others" && m === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE admin_id = ? AND id != ?").bind(admin.id, admin.sessionId).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: "not_found" }, 404);
}
