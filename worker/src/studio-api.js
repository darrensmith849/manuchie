/* The studio desk: projects (with to-do lists), money in and out, and clients added by hand.
   Routed from admin-api.js, so every call here already passed requireAdmin().
   Amounts are whole cents in the studio currency (settings key "currency"). */

import { json, csv, readBody } from "./lib/http.js";
import { clean, normEmail, isEmail, toCsv, parseMoney, isDay } from "./lib/text.js";
import { newId } from "./lib/crypto.js";

export const PROJECT_STATUSES = ["lead", "booked", "in_progress", "review", "completed", "on_hold", "cancelled"];
export const PROJECT_TYPES = ["production", "songwriting", "vocal_production", "mixing_mastering", "music_direction", "keys", "arrangement", "other"];
export const CURRENCIES = ["USD", "AUD", "ZAR", "GBP", "EUR", "NZD", "CAD", "ZWG", "NGN", "KES"];
const ACTIVE = ["booked", "in_progress", "review"];
const VIEWS = { active: ACTIVE, leads: ["lead"], completed: ["completed"], on_hold: ["on_hold", "cancelled"], all: null };
export const EXPENSE_CATEGORIES = ["Studio hire", "Musicians & vocalists", "Mixing & mastering", "Equipment", "Software & plugins", "Travel", "Marketing", "Other"];
export const INCOME_CATEGORIES = ["Deposit", "Final payment", "Royalties", "Performance", "Other"];

const all = async (stmt) => (await stmt.all()).results || [];
const nowIso = () => new Date().toISOString();
const today = () => nowIso().slice(0, 10);
const uuid = (s) => /^[0-9a-f-]{36}$/.test(s || "");
const like = (q) => "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
const bad = (field, message, status = 400) => json({ ok: false, error: field, message }, status);

export async function getCurrency(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'currency'").first();
  return row && CURRENCIES.includes(row.value) ? row.value : "USD";
}

/* ---------- clients ---------- */

/* Creates a client by hand. Returns { id } or { error, message }. */
export async function createClient(env, input) {
  const name = clean(input.name, 120);
  const email = clean(input.email, 254);
  if (!name) return { error: "name", message: "Enter the client's name." };
  if (email && !isEmail(email)) return { error: "email", message: "Enter a valid email address, or leave it empty." };
  const id = newId();
  if (email && (await env.DB.prepare("SELECT id FROM contacts WHERE email_norm = ?").bind(normEmail(email)).first())) {
    return { error: "email_taken", message: "A client with that email already exists." };
  }
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO contacts (id, email, email_norm, name, created_at, updated_at, source, phone, company, notes)
                        VALUES (?, ?, ?, ?, ?, ?, 'added by hand', ?, ?, ?)`)
    .bind(id, email, email ? normEmail(email) : "none:" + id, name, now, now,
      clean(input.phone, 40), clean(input.company, 120), clean(input.notes, 5000, { multiline: true })).run();
  return { id };
}

async function postClient(env, request) {
  const { data = {} } = await readBody(request, 10000);
  const r = await createClient(env, data);
  return r.error ? bad(r.error, r.message, r.error === "email_taken" ? 409 : 400) : json({ ok: true, id: r.id });
}

/* ---------- projects ---------- */

const PROJECT_SELECT = `SELECT p.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone, c.company AS client_company,
  (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id) AS tasks_total,
  (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.done = 1) AS tasks_done,
  (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions x WHERE x.project_id = p.id AND x.kind = 'income' AND x.settled = 1) AS received_cents,
  (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions x WHERE x.project_id = p.id AND x.kind = 'income' AND x.settled = 0) AS expected_cents,
  (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions x WHERE x.project_id = p.id AND x.kind = 'expense') AS expenses_cents
  FROM projects p LEFT JOIN contacts c ON c.id = p.contact_id`;

async function listProjects(env, params) {
  const view = VIEWS[params.get("view")] !== undefined ? params.get("view") : "active";
  const where = [];
  const binds = [];
  if (VIEWS[view]) { where.push(`p.status IN (${VIEWS[view].map(() => "?").join(",")})`); binds.push(...VIEWS[view]); }
  const q = clean(params.get("q"), 100);
  if (q) { where.push("(p.title LIKE ? ESCAPE '\\' OR p.notes LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')"); binds.push(like(q), like(q), like(q)); }
  if (uuid(params.get("client"))) { where.push("p.contact_id = ?"); binds.push(params.get("client")); }
  const order = view === "active" || view === "leads"
    ? "CASE WHEN p.due_date IS NULL THEN 1 ELSE 0 END, p.due_date ASC, p.updated_at DESC"
    : "COALESCE(p.completed_at, p.updated_at) DESC";
  const [rows, counts] = await Promise.all([
    all(env.DB.prepare(`${PROJECT_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT 200`).bind(...binds)),
    all(env.DB.prepare("SELECT status, COUNT(*) AS n FROM projects GROUP BY status")),
  ]);
  return json({ rows, view, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), today: today() });
}

async function getProject(env, id) {
  const p = await env.DB.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).bind(id).first();
  if (!p) return json({ ok: false, error: "not_found" }, 404);
  const [tasks, money] = await Promise.all([
    all(env.DB.prepare("SELECT * FROM project_tasks WHERE project_id = ? ORDER BY done, position, created_at").bind(id)),
    all(env.DB.prepare("SELECT * FROM transactions WHERE project_id = ? ORDER BY date DESC, created_at DESC").bind(id)),
  ]);
  return json({ project: p, tasks, transactions: money, today: today() });
}

/* Validates project fields from a request body. Returns { sets: {column: value}, error }. */
async function projectFields(env, data, creating) {
  const sets = {};
  if (data.title !== undefined || creating) {
    const t = clean(data.title, 160);
    if (!t) return { error: bad("title", "Give the project a name.") };
    sets.title = t;
  }
  if (data.type !== undefined) {
    if (!PROJECT_TYPES.includes(data.type)) return { error: bad("type", "Choose a project type.") };
    sets.type = data.type;
  }
  if (data.status !== undefined) {
    if (!PROJECT_STATUSES.includes(data.status)) return { error: bad("status", "Choose a stage.") };
    sets.status = data.status;
  }
  if (data.progress !== undefined) {
    const n = Math.round(Number(data.progress));
    if (!(n >= 0 && n <= 100)) return { error: bad("progress", "Progress is 0 to 100.") };
    sets.progress = n;
  }
  for (const k of ["start_date", "due_date"]) {
    if (data[k] === undefined) continue;
    if (data[k] === "" || data[k] === null) { sets[k] = null; continue; }
    if (!isDay(data[k])) return { error: bad(k, "Use a real date.") };
    sets[k] = data[k];
  }
  if (data.fee !== undefined) {
    const c = data.fee === "" || data.fee === null ? 0 : parseMoney(data.fee);
    if (c === null) return { error: bad("fee", "Enter the fee as a number, e.g. 1500 or 1,500.00.") };
    sets.fee_cents = c;
  }
  if (data.notes !== undefined) sets.notes = clean(data.notes, 20000, { multiline: true });
  if (data.contact_id !== undefined) {
    if (data.contact_id === "" || data.contact_id === null) sets.contact_id = null;
    else if (uuid(data.contact_id) && (await env.DB.prepare("SELECT id FROM contacts WHERE id = ?").bind(data.contact_id).first())) sets.contact_id = data.contact_id;
    else return { error: bad("contact_id", "That client wasn't found.") };
  }
  return { sets };
}

async function createProject(env, request) {
  const { data = {} } = await readBody(request, 40000);
  const { sets, error } = await projectFields(env, data, true);
  if (error) return error;
  if (data.enquiry_id && uuid(data.enquiry_id)) {
    const e = await env.DB.prepare("SELECT id, contact_id FROM enquiries WHERE id = ?").bind(data.enquiry_id).first();
    if (e) { sets.enquiry_id = e.id; if (sets.contact_id === undefined && e.contact_id) sets.contact_id = e.contact_id; }
  }
  if (!sets.contact_id && data.client && clean(data.client.name, 120)) {
    const c = await createClient(env, data.client);
    if (c.error) return bad("client_" + c.error, c.message, c.error === "email_taken" ? 409 : 400);
    sets.contact_id = c.id;
  }
  const id = newId();
  const now = nowIso();
  sets.status = sets.status || "booked";
  if (sets.status === "completed") { sets.completed_at = now; sets.progress = 100; }
  const cols = ["id", "created_at", "updated_at", ...Object.keys(sets)];
  await env.DB.prepare(`INSERT INTO projects (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .bind(id, now, now, ...Object.values(sets)).run();
  return json({ ok: true, id });
}

async function updateProject(env, id, request) {
  const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!p) return json({ ok: false, error: "not_found" }, 404);
  const { data = {} } = await readBody(request, 40000);
  const { sets, error } = await projectFields(env, data, false);
  if (error) return error;
  if (sets.status === "completed" && p.status !== "completed") {
    sets.completed_at = nowIso();
    if (sets.progress === undefined) sets.progress = 100;
  } else if (sets.status && sets.status !== "completed" && p.status === "completed") {
    sets.completed_at = null;
  }
  sets.updated_at = nowIso();
  await env.DB.prepare(`UPDATE projects SET ${Object.keys(sets).map((k) => k + " = ?").join(", ")} WHERE id = ?`)
    .bind(...Object.values(sets), id).run();
  return getProject(env, id);
}

async function deleteProject(env, id) {
  const r = await env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
  return r.meta.changes ? json({ ok: true }) : json({ ok: false, error: "not_found" }, 404);
}

/* Progress follows the to-do list once a project has one (completed projects stay at 100). */
async function syncProgress(env, projectId) {
  const t = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(done) AS done FROM project_tasks WHERE project_id = ?").bind(projectId).first();
  if (!t.total) return;
  await env.DB.prepare("UPDATE projects SET progress = CASE WHEN status = 'completed' THEN 100 ELSE ? END, updated_at = ? WHERE id = ?")
    .bind(Math.round(((t.done || 0) / t.total) * 100), nowIso(), projectId).run();
}

async function addTask(env, projectId, request) {
  if (!(await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first())) return json({ ok: false, error: "not_found" }, 404);
  const { data = {} } = await readBody(request, 4000);
  const title = clean(data.title, 300);
  if (!title) return bad("title", "Write what needs doing.");
  const pos = await env.DB.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM project_tasks WHERE project_id = ?").bind(projectId).first();
  await env.DB.prepare("INSERT INTO project_tasks (id, project_id, title, position, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(newId(), projectId, title, pos.p, nowIso()).run();
  await syncProgress(env, projectId);
  return getProject(env, projectId);
}

async function updateTask(env, taskId, request) {
  const t = await env.DB.prepare("SELECT * FROM project_tasks WHERE id = ?").bind(taskId).first();
  if (!t) return json({ ok: false, error: "not_found" }, 404);
  const { data = {} } = await readBody(request, 4000);
  const sets = {};
  if (data.title !== undefined) {
    const title = clean(data.title, 300);
    if (!title) return bad("title", "Write what needs doing.");
    sets.title = title;
  }
  if (data.done !== undefined) { sets.done = data.done ? 1 : 0; sets.done_at = data.done ? nowIso() : null; }
  if (Object.keys(sets).length) {
    await env.DB.prepare(`UPDATE project_tasks SET ${Object.keys(sets).map((k) => k + " = ?").join(", ")} WHERE id = ?`).bind(...Object.values(sets), taskId).run();
  }
  await syncProgress(env, t.project_id);
  return getProject(env, t.project_id);
}

async function deleteTask(env, taskId) {
  const t = await env.DB.prepare("SELECT project_id FROM project_tasks WHERE id = ?").bind(taskId).first();
  if (!t) return json({ ok: false, error: "not_found" }, 404);
  await env.DB.prepare("DELETE FROM project_tasks WHERE id = ?").bind(taskId).run();
  await syncProgress(env, t.project_id);
  return getProject(env, t.project_id);
}

/* ---------- money ---------- */

async function transactionFields(env, data, creating) {
  const sets = {};
  if (data.kind !== undefined || creating) {
    if (!["income", "expense"].includes(data.kind)) return { error: bad("kind", "Choose income or expense.") };
    sets.kind = data.kind;
  }
  if (data.amount !== undefined || creating) {
    const c = parseMoney(data.amount);
    if (c === null || c === 0) return { error: bad("amount", "Enter an amount, e.g. 500 or 1,250.00.") };
    sets.amount_cents = c;
  }
  if (data.date !== undefined || creating) {
    const d = data.date || today();
    if (!isDay(d)) return { error: bad("date", "Use a real date.") };
    sets.date = d;
  }
  if (data.settled !== undefined) sets.settled = data.settled ? 1 : 0;
  else if (creating) sets.settled = 1;
  if (data.category !== undefined) sets.category = clean(data.category, 60);
  if (data.description !== undefined) sets.description = clean(data.description, 300);
  if (data.project_id !== undefined) {
    if (data.project_id === "" || data.project_id === null) sets.project_id = null;
    else if (uuid(data.project_id) && (await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(data.project_id).first())) sets.project_id = data.project_id;
    else return { error: bad("project_id", "That project wasn't found.") };
  }
  return { sets };
}

async function createTransaction(env, request) {
  const { data = {} } = await readBody(request, 10000);
  const { sets, error } = await transactionFields(env, data, true);
  if (error) return error;
  const id = newId();
  const now = nowIso();
  const cols = ["id", "created_at", "updated_at", ...Object.keys(sets)];
  await env.DB.prepare(`INSERT INTO transactions (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .bind(id, now, now, ...Object.values(sets)).run();
  return json({ ok: true, id });
}

async function updateTransaction(env, id, request) {
  if (!(await env.DB.prepare("SELECT id FROM transactions WHERE id = ?").bind(id).first())) return json({ ok: false, error: "not_found" }, 404);
  const { data = {} } = await readBody(request, 10000);
  const { sets, error } = await transactionFields(env, data, false);
  if (error) return error;
  sets.updated_at = nowIso();
  await env.DB.prepare(`UPDATE transactions SET ${Object.keys(sets).map((k) => k + " = ?").join(", ")} WHERE id = ?`).bind(...Object.values(sets), id).run();
  return json({ ok: true, transaction: await env.DB.prepare("SELECT * FROM transactions WHERE id = ?").bind(id).first() });
}

async function deleteTransaction(env, id) {
  const r = await env.DB.prepare("DELETE FROM transactions WHERE id = ?").bind(id).run();
  return r.meta.changes ? json({ ok: true }) : json({ ok: false, error: "not_found" }, 404);
}

/* Period for the money page: this month, last 3 months, this year, all time. */
function moneyRange(params) {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const day = (d) => d.toISOString().slice(0, 10);
  const r = params.get("range") || "month";
  if (r === "all") return { range: r, from: "0000-01-01", to: "9999-12-31" };
  if (r === "year") return { range: r, from: `${y}-01-01`, to: `${y}-12-31` };
  if (r === "3m") return { range: r, from: day(new Date(Date.UTC(y, m - 2, 1))), to: day(new Date(Date.UTC(y, m + 1, 0))) };
  return { range: "month", from: day(new Date(Date.UTC(y, m, 1))), to: day(new Date(Date.UTC(y, m + 1, 0))) };
}

function txFilters(params) {
  const where = [];
  const binds = [];
  if (["income", "expense"].includes(params.get("kind"))) { where.push("x.kind = ?"); binds.push(params.get("kind")); }
  if (params.get("settled") === "0" || params.get("settled") === "1") { where.push("x.settled = ?"); binds.push(Number(params.get("settled"))); }
  if (uuid(params.get("project"))) { where.push("x.project_id = ?"); binds.push(params.get("project")); }
  if (isDay(params.get("from"))) { where.push("x.date >= ?"); binds.push(params.get("from")); }
  if (isDay(params.get("to"))) { where.push("x.date <= ?"); binds.push(params.get("to")); }
  const q = clean(params.get("q"), 100);
  if (q) { where.push("(x.description LIKE ? ESCAPE '\\' OR x.category LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\')"); binds.push(like(q), like(q), like(q)); }
  return { sql: where.length ? "WHERE " + where.join(" AND ") : "", binds };
}

async function money(env, params) {
  const r = moneyRange(params);
  const sum = (sql, ...b) => env.DB.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transactions WHERE ${sql}`).bind(...b);
  const now = new Date();
  const monthsFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString().slice(0, 7);
  const [received, expected, spent, due, uninvoiced, monthly, categories, upcoming, recent] = await Promise.all([
    sum("kind = 'income' AND settled = 1 AND date BETWEEN ? AND ?", r.from, r.to).first(),
    sum("kind = 'income' AND settled = 0").first(),
    sum("kind = 'expense' AND settled = 1 AND date BETWEEN ? AND ?", r.from, r.to).first(),
    sum("kind = 'expense' AND settled = 0").first(),
    env.DB.prepare(`SELECT COALESCE(SUM(MAX(p.fee_cents - COALESCE(i.n, 0), 0)), 0) AS n FROM projects p
                    LEFT JOIN (SELECT project_id, SUM(amount_cents) AS n FROM transactions WHERE kind = 'income' GROUP BY project_id) i ON i.project_id = p.id
                    WHERE p.status NOT IN ('cancelled', 'lead')`).first(),
    all(env.DB.prepare(`SELECT substr(date, 1, 7) AS month, kind, SUM(amount_cents) AS n FROM transactions
                        WHERE settled = 1 AND substr(date, 1, 7) >= ? GROUP BY 1, 2`).bind(monthsFrom)),
    all(env.DB.prepare(`SELECT COALESCE(NULLIF(category, ''), 'Other') AS name, SUM(amount_cents) AS n FROM transactions
                        WHERE kind = 'expense' AND settled = 1 AND date BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC`).bind(r.from, r.to)),
    all(env.DB.prepare(`SELECT x.*, p.title AS project_title FROM transactions x LEFT JOIN projects p ON p.id = x.project_id
                        WHERE x.settled = 0 ORDER BY x.date ASC LIMIT 12`)),
    all(env.DB.prepare(`SELECT x.*, p.title AS project_title FROM transactions x LEFT JOIN projects p ON p.id = x.project_id
                        WHERE x.date BETWEEN ? AND ? ORDER BY x.date DESC, x.created_at DESC LIMIT 60`).bind(r.from, r.to)),
  ]);
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const k = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    months.push({ month: k, income: 0, expense: 0 });
  }
  for (const row of monthly) { const m = months.find((x) => x.month === row.month); if (m) m[row.kind] = row.n; }
  return json({
    range: r, currency: await getCurrency(env),
    totals: { received: received.n, expected: expected.n, spent: spent.n, due: due.n, uninvoiced: uninvoiced.n, net: received.n - spent.n },
    months, categories, upcoming, recent,
    expenseCategories: EXPENSE_CATEGORIES, incomeCategories: INCOME_CATEGORIES,
  });
}

async function listTransactions(env, params) {
  const f = txFilters(params);
  const rows = await all(env.DB.prepare(`SELECT x.*, p.title AS project_title FROM transactions x LEFT JOIN projects p ON p.id = x.project_id
                                          ${f.sql} ORDER BY x.date DESC, x.created_at DESC LIMIT 500`).bind(...f.binds));
  return json({ rows });
}

async function exportTransactions(env, params) {
  const f = txFilters(params);
  const cur = await getCurrency(env);
  const rows = await all(env.DB.prepare(`SELECT x.*, p.title AS project_title FROM transactions x LEFT JOIN projects p ON p.id = x.project_id
                                          ${f.sql} ORDER BY x.date DESC LIMIT 20000`).bind(...f.binds));
  return csv(`manuchie-money-${today()}.csv`, toCsv(rows, [
    { label: "Date", key: "date" },
    { label: "Type", value: (x) => (x.kind === "income" ? "Income" : "Expense") },
    { label: "Status", value: (x) => (x.kind === "income" ? (x.settled ? "Received" : "Expected") : (x.settled ? "Paid" : "Due")) },
    { label: `Amount (${cur})`, value: (x) => (x.amount_cents / 100).toFixed(2) },
    { label: "Category", key: "category" }, { label: "Description", key: "description" }, { label: "Project", key: "project_title" },
  ]));
}

/* Numbers for the overview's studio strip. */
export async function studioSummary(env) {
  const t = today();
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const month = t.slice(0, 7);
  const [counts, received, expected, spent, projects] = await Promise.all([
    env.DB.prepare(`SELECT
        SUM(status IN ('booked', 'in_progress', 'review')) AS active,
        SUM(status IN ('booked', 'in_progress', 'review') AND due_date IS NOT NULL AND due_date < ?) AS overdue,
        SUM(status IN ('booked', 'in_progress', 'review') AND due_date BETWEEN ? AND ?) AS due_soon,
        SUM(status = 'lead') AS leads FROM projects`).bind(t, t, in7).first(),
    env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transactions WHERE kind = 'income' AND settled = 1 AND substr(date, 1, 7) = ?").bind(month).first(),
    env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transactions WHERE kind = 'income' AND settled = 0").first(),
    env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transactions WHERE kind = 'expense' AND settled = 1 AND substr(date, 1, 7) = ?").bind(month).first(),
    all(env.DB.prepare(`${PROJECT_SELECT} WHERE p.status IN ('booked', 'in_progress', 'review')
                        ORDER BY CASE WHEN p.due_date IS NULL THEN 1 ELSE 0 END, p.due_date ASC LIMIT 5`)),
  ]);
  return {
    active: counts.active || 0, overdue: counts.overdue || 0, due_soon: counts.due_soon || 0, leads: counts.leads || 0,
    received_month: received.n, expected: expected.n, spent_month: spent.n, projects, today: t, currency: await getCurrency(env),
  };
}

/* ---------- router ---------- */

export async function handleStudioApi(request, env, parts) {
  const url = new URL(request.url);
  const p = url.searchParams;
  const m = request.method;
  const [resource, id, sub] = parts;

  if (resource === "projects" && !id && m === "GET") return listProjects(env, p);
  if (resource === "projects" && !id && m === "POST") return createProject(env, request);
  if (resource === "projects" && uuid(id)) {
    if (!sub && m === "GET") return getProject(env, id);
    if (!sub && m === "PATCH") return updateProject(env, id, request);
    if (!sub && m === "DELETE") return deleteProject(env, id);
    if (sub === "tasks" && m === "POST") return addTask(env, id, request);
  }
  if (resource === "tasks" && uuid(id)) {
    if (m === "PATCH") return updateTask(env, id, request);
    if (m === "DELETE") return deleteTask(env, id);
  }
  if (resource === "money" && m === "GET") return money(env, p);
  if (resource === "transactions.csv" && m === "GET") return exportTransactions(env, p);
  if (resource === "transactions" && !id && m === "GET") return listTransactions(env, p);
  if (resource === "transactions" && !id && m === "POST") return createTransaction(env, request);
  if (resource === "transactions" && uuid(id)) {
    if (m === "PATCH") return updateTransaction(env, id, request);
    if (m === "DELETE") return deleteTransaction(env, id);
  }
  if (resource === "clients" && m === "POST") return postClient(env, request);
  if (resource === "settings" && id === "currency" && m === "POST") {
    const { data = {} } = await readBody(request, 1000);
    if (!CURRENCIES.includes(data.currency)) return bad("currency", "Choose a currency from the list.");
    await env.DB.prepare("INSERT INTO settings (key, value, created_at) VALUES ('currency', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(data.currency, nowIso()).run();
    return json({ ok: true, currency: data.currency });
  }
  return null; // not a studio route
}
