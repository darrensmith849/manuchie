/* Invoices: numbering, totals, "paid" → income, private share links, and the branded PDF.
   Admin routes are dispatched from studio-api.js (already behind requireAdmin); the public
   share link /invoice/<token> is served from index.js. */

import { json, readBody, PRIVATE_HEADERS } from "./lib/http.js";
import { clean, isEmail, parseMoney, isDay } from "./lib/text.js";
import { newId, randomToken } from "./lib/crypto.js";
import { Pdf, textWidth, wrapText } from "./lib/pdf.js";

export const DEFAULT_BUSINESS = {
  name: "Manuchie",
  tagline: "Producer · Songwriter · Music Director",
  legal_name: "",
  email: "",
  phone: "",
  website: "manuchie.org",
  address: "Harare, Zimbabwe",
  tax_label: "",
  tax_number: "",
  bank: "",
  terms: "Payment is due within 14 days of the invoice date. Thank you — it's a privilege to make music with you.",
  prefix: "MAN",
  due_days: 14,
  tax_bp: 0,
};
const SYMBOLS = { USD: "$", AUD: "A$", ZAR: "R", GBP: "£", EUR: "€", NZD: "NZ$", CAD: "CA$", ZWG: "ZiG ", NGN: "NGN ", KES: "KSh " };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const all = async (stmt) => (await stmt.all()).results || [];
const nowIso = () => new Date().toISOString();
const today = () => nowIso().slice(0, 10);
const bad = (field, message, status = 400) => json({ ok: false, error: field, message }, status);
const uuid = (s) => /^[0-9a-f-]{36}$/.test(s || "");
const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export function formatMoney(cents, currency) {
  const v = Math.abs(cents || 0) / 100;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (cents < 0 ? "-" : "") + (SYMBOLS[currency] ?? currency + " ") + s;
}
export const formatDay = (d) => (d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "—");

/* ---------- settings ---------- */

export async function getBusiness(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'business'").first();
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
  return { ...DEFAULT_BUSINESS, ...saved };
}

export async function saveBusiness(env, data) {
  const cur = await getBusiness(env);
  const next = { ...cur };
  const text = { name: 80, tagline: 120, legal_name: 120, phone: 40, website: 120, address: 400, tax_label: 40, tax_number: 60, bank: 1000, terms: 2000 };
  for (const [k, max] of Object.entries(text)) if (data[k] !== undefined) next[k] = clean(data[k], max, { multiline: k === "address" || k === "bank" || k === "terms" });
  if (data.email !== undefined) {
    const e = clean(data.email, 254);
    if (e && !isEmail(e)) return { error: bad("email", "Enter a valid email address for your invoices.") };
    next.email = e;
  }
  if (data.prefix !== undefined) {
    const p = clean(data.prefix, 12).toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!p) return { error: bad("prefix", "Use letters or numbers for the invoice prefix, e.g. MAN.") };
    next.prefix = p;
  }
  if (data.due_days !== undefined) {
    const n = Math.round(Number(data.due_days));
    if (!(n >= 0 && n <= 365)) return { error: bad("due_days", "Payment terms are 0 to 365 days.") };
    next.due_days = n;
  }
  if (data.tax_rate !== undefined) {
    const r = Number(String(data.tax_rate).replace(",", ".") || 0);
    if (!(r >= 0 && r <= 100)) return { error: bad("tax_rate", "Tax is a percentage from 0 to 100.") };
    next.tax_bp = Math.round(r * 100);
  }
  if (!next.name) return { error: bad("name", "Your business name appears on every invoice.") };
  await env.DB.prepare("INSERT INTO settings (key, value, created_at) VALUES ('business', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(next), nowIso()).run();
  return { business: next };
}

/* ---------- totals ---------- */

export function parseItems(value) {
  let list = value;
  if (typeof value === "string") { try { list = JSON.parse(value); } catch { list = []; } }
  return (Array.isArray(list) ? list : []).map((it) => ({
    description: String(it.description || ""), qty: Number(it.qty) || 0, unit_cents: Math.max(0, Math.round(Number(it.unit_cents) || 0)),
  }));
}

export function invoiceTotals(inv) {
  const items = parseItems(inv.items);
  const subtotal = items.reduce((a, it) => a + Math.round(it.qty * it.unit_cents), 0);
  const discount = Math.min(inv.discount_cents || 0, subtotal);
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * (inv.tax_bp || 0)) / 10000);
  return { items, subtotal, discount, tax, total: taxable + tax };
}

const withTotals = (inv, t = today()) => {
  const totals = invoiceTotals(inv);
  const overdue = inv.status === "sent" && inv.due_date && inv.due_date < t;
  return { ...inv, items: totals.items, totals, display_status: overdue ? "overdue" : inv.status };
};

/* ---------- numbering ---------- */

async function nextNumber(env, prefix) {
  const year = today().slice(0, 4);
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'invoice_seq'").first();
  // stored as "YEAR:N", so numbering starts again at 001 each year
  const [y, n] = row ? String(row.value).split(":") : [];
  let seq = (y === year ? Number(n) || 0 : 0) + 1;
  for (let i = 0; i < 50; i++, seq++) {
    const number = `${prefix}-${year}-${String(seq).padStart(3, "0")}`;
    if (!(await env.DB.prepare("SELECT id FROM invoices WHERE number = ?").bind(number).first())) {
      await env.DB.prepare("INSERT INTO settings (key, value, created_at) VALUES ('invoice_seq', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(`${year}:${seq}`, nowIso()).run();
      return number;
    }
  }
  return `${prefix}-${year}-${Date.now().toString(36).toUpperCase()}`;
}

/* ---------- CRUD ---------- */

async function listInvoices(env, params) {
  const where = [];
  const binds = [];
  const status = params.get("status") || "all";
  if (["draft", "sent", "paid", "void"].includes(status)) { where.push("i.status = ?"); binds.push(status); }
  if (status === "overdue") { where.push("i.status = 'sent' AND i.due_date IS NOT NULL AND i.due_date < ?"); binds.push(today()); }
  const q = clean(params.get("q"), 100);
  if (q) { where.push("(i.number LIKE ? OR i.client_name LIKE ? OR i.client_company LIKE ? OR p.title LIKE ?)"); binds.push(...Array(4).fill("%" + q + "%")); }
  if (uuid(params.get("project"))) { where.push("i.project_id = ?"); binds.push(params.get("project")); }
  const rows = (await all(env.DB.prepare(`SELECT i.*, p.title AS project_title FROM invoices i LEFT JOIN projects p ON p.id = i.project_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY i.issue_date DESC, i.created_at DESC LIMIT 500`).bind(...binds))).map((r) => withTotals(r));
  const everything = (await all(env.DB.prepare("SELECT status, due_date, items, discount_cents, tax_bp, paid_at FROM invoices"))).map((r) => withTotals(r));
  const sum = (list) => list.reduce((a, r) => a + r.totals.total, 0);
  const year = today().slice(0, 4);
  return json({
    rows,
    summary: {
      outstanding: sum(everything.filter((r) => r.status === "sent")),
      overdue: sum(everything.filter((r) => r.display_status === "overdue")),
      paid_year: sum(everything.filter((r) => r.status === "paid" && (r.paid_at || "").startsWith(year))),
      drafts: everything.filter((r) => r.status === "draft").length,
      // matches the filters: "sent" includes the overdue ones, which are also counted on their own
      counts: everything.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), r.display_status === "overdue" && (a.overdue = (a.overdue || 0) + 1), a), {}),
    },
  });
}

async function getInvoice(env, id) {
  const inv = await env.DB.prepare("SELECT i.*, p.title AS project_title FROM invoices i LEFT JOIN projects p ON p.id = i.project_id WHERE i.id = ?").bind(id).first();
  if (!inv) return json({ ok: false, error: "not_found" }, 404);
  return json({ invoice: withTotals(inv), business: await getBusiness(env) });
}

async function createInvoice(env, request, currency) {
  const { data = {} } = await readBody(request, 10000);
  const biz = await getBusiness(env);
  const issue = today();
  const row = {
    id: newId(), number: await nextNumber(env, biz.prefix), status: "draft", issue_date: issue, due_date: addDays(issue, biz.due_days),
    currency, tax_bp: biz.tax_bp, tax_label: biz.tax_label ? biz.tax_label.replace(/ number$/i, "") || "Tax" : "Tax", notes: biz.terms,
    items: "[]", project_id: null, contact_id: null, client_name: "", client_company: "", client_email: "", client_phone: "", client_address: "",
  };
  let contactId = uuid(data.contact_id) ? data.contact_id : null;
  if (uuid(data.project_id)) {
    const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(data.project_id).first();
    if (p) {
      row.project_id = p.id;
      contactId = contactId || p.contact_id;
      const invoiced = (await all(env.DB.prepare("SELECT items, discount_cents, tax_bp FROM invoices WHERE project_id = ? AND status != 'void'").bind(p.id)))
        .reduce((a, r) => a + invoiceTotals(r).subtotal, 0);
      const remaining = Math.max(0, p.fee_cents - invoiced);
      row.items = JSON.stringify([{ description: p.title + (p.type ? " — " + p.type : ""), qty: 1, unit_cents: remaining || p.fee_cents }]);
    }
  }
  if (contactId) {
    const c = await env.DB.prepare("SELECT * FROM contacts WHERE id = ?").bind(contactId).first();
    if (c) Object.assign(row, { contact_id: c.id, client_name: c.name, client_company: c.company || "", client_email: c.email || "", client_phone: c.phone || "" });
  }
  if (row.items === "[]") row.items = JSON.stringify([{ description: "", qty: 1, unit_cents: 0 }]);
  const now = nowIso();
  const cols = [...Object.keys(row), "created_at", "updated_at"];
  await env.DB.prepare(`INSERT INTO invoices (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...Object.values(row), now, now).run();
  return json({ ok: true, id: row.id });
}

async function updateInvoice(env, id, request) {
  const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first();
  if (!inv) return json({ ok: false, error: "not_found" }, 404);
  const { data = {} } = await readBody(request, 60000);
  const sets = {};
  if (data.number !== undefined) {
    const n = clean(data.number, 40);
    if (!n) return bad("number", "An invoice needs a number.");
    if (await env.DB.prepare("SELECT id FROM invoices WHERE number = ? AND id != ?").bind(n, id).first()) return bad("number", "Another invoice already uses that number.", 409);
    sets.number = n;
  }
  for (const k of ["issue_date", "due_date"]) {
    if (data[k] === undefined) continue;
    if (k === "due_date" && !data[k]) { sets.due_date = null; continue; }
    if (!isDay(data[k])) return bad(k, "Use a real date.");
    sets[k] = data[k];
  }
  const text = { client_name: 120, client_company: 120, client_phone: 40, client_address: 400, tax_label: 30, notes: 5000 };
  for (const [k, max] of Object.entries(text)) if (data[k] !== undefined) sets[k] = clean(data[k], max, { multiline: k === "client_address" || k === "notes" });
  if (data.client_email !== undefined) {
    const e = clean(data.client_email, 254);
    if (e && !isEmail(e)) return bad("client_email", "Enter a valid email address for the client, or leave it empty.");
    sets.client_email = e;
  }
  if (data.items !== undefined) {
    if (!Array.isArray(data.items) || data.items.length > 60) return bad("items", "Up to 60 lines per invoice.");
    const items = [];
    for (const it of data.items) {
      const qty = Number(String(it.qty ?? 1).replace(",", "."));
      if (!(qty >= 0 && qty <= 100000)) return bad("items", "Quantities are numbers like 1, 2 or 1.5.");
      const unit = it.unit === "" || it.unit === undefined ? 0 : parseMoney(it.unit);
      if (unit === null) return bad("items", `“${clean(it.description, 40) || "A line"}” needs a price like 500 or 1,250.00.`);
      items.push({ description: clean(it.description, 300, { multiline: true }), qty: Math.round(qty * 100) / 100, unit_cents: unit });
    }
    sets.items = JSON.stringify(items);
  }
  if (data.discount !== undefined) {
    const d = data.discount === "" ? 0 : parseMoney(data.discount);
    if (d === null) return bad("discount", "Enter the discount as an amount, e.g. 100.");
    sets.discount_cents = d;
  }
  if (data.tax_rate !== undefined) {
    const r = Number(String(data.tax_rate || 0).replace(",", "."));
    if (!(r >= 0 && r <= 100)) return bad("tax_rate", "Tax is a percentage from 0 to 100.");
    sets.tax_bp = Math.round(r * 100);
  }
  if (data.status !== undefined) {
    if (!["draft", "sent", "void"].includes(data.status)) return bad("status", "Use Mark as paid to record a payment.");
    if (inv.status === "paid") await unpay(env, inv);
    sets.status = data.status;
    if (data.status === "sent" && !inv.sent_at) sets.sent_at = nowIso();
    if (inv.status === "paid") sets.paid_at = null;
  }
  for (const k of ["project_id", "contact_id"]) {
    if (data[k] === undefined) continue;
    if (!data[k]) { sets[k] = null; continue; }
    const table = k === "project_id" ? "projects" : "contacts";
    if (!uuid(data[k]) || !(await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(data[k]).first())) return bad(k, "Not found.");
    sets[k] = data[k];
  }
  if (Object.keys(sets).length) {
    sets.updated_at = nowIso();
    await env.DB.prepare(`UPDATE invoices SET ${Object.keys(sets).map((k) => k + " = ?").join(", ")} WHERE id = ?`).bind(...Object.values(sets), id).run();
  }
  return getInvoice(env, id);
}

/* Paying an invoice logs the income: an expected payment on the same project for the same
   amount is marked received; otherwise a new received entry is created. */
async function markPaid(env, id, request) {
  const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first();
  if (!inv) return json({ ok: false, error: "not_found" }, 404);
  if (inv.status === "paid") return getInvoice(env, id);
  const { data = {} } = await readBody(request, 2000);
  const date = isDay(data.date) ? data.date : today();
  const total = invoiceTotals(inv).total;
  const now = nowIso();
  let txId = null;
  if (inv.project_id) {
    const expected = await env.DB.prepare("SELECT id FROM transactions WHERE project_id = ? AND kind = 'income' AND settled = 0 AND amount_cents = ? ORDER BY date LIMIT 1")
      .bind(inv.project_id, total).first();
    if (expected) {
      txId = expected.id;
      await env.DB.prepare("UPDATE transactions SET settled = 1, date = ?, description = ?, updated_at = ? WHERE id = ?")
        .bind(date, `Invoice ${inv.number}`, now, txId).run();
    }
  }
  if (!txId && total > 0) {
    txId = newId();
    await env.DB.prepare(`INSERT INTO transactions (id, project_id, kind, amount_cents, date, settled, category, description, created_at, updated_at)
                          VALUES (?, ?, 'income', ?, ?, 1, 'Invoice', ?, ?, ?)`).bind(txId, inv.project_id, total, date, `Invoice ${inv.number}`, now, now).run();
  }
  await env.DB.prepare("UPDATE invoices SET status = 'paid', paid_at = ?, transaction_id = ?, sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?")
    .bind(date + "T12:00:00.000Z", txId, now, now, id).run();
  return getInvoice(env, id);
}

/* Undoing "paid": a payment this invoice created is removed; one it reused goes back to expected. */
async function unpay(env, inv) {
  if (!inv.transaction_id) return;
  const tx = await env.DB.prepare("SELECT * FROM transactions WHERE id = ?").bind(inv.transaction_id).first();
  if (!tx) return;
  if (tx.category === "Invoice") await env.DB.prepare("DELETE FROM transactions WHERE id = ?").bind(tx.id).run();
  else await env.DB.prepare("UPDATE transactions SET settled = 0, updated_at = ? WHERE id = ?").bind(nowIso(), tx.id).run();
  await env.DB.prepare("UPDATE invoices SET transaction_id = NULL WHERE id = ?").bind(inv.id).run();
}

async function duplicateInvoice(env, id) {
  const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first();
  if (!inv) return json({ ok: false, error: "not_found" }, 404);
  const biz = await getBusiness(env);
  const issue = today();
  const copy = { ...inv, id: newId(), number: await nextNumber(env, biz.prefix), status: "draft", issue_date: issue, due_date: addDays(issue, biz.due_days),
    share_token: null, transaction_id: null, sent_at: null, paid_at: null, created_at: nowIso(), updated_at: nowIso() };
  const cols = Object.keys(copy);
  await env.DB.prepare(`INSERT INTO invoices (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...Object.values(copy)).run();
  return json({ ok: true, id: copy.id });
}

async function deleteInvoice(env, id) {
  const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first();
  if (!inv) return json({ ok: false, error: "not_found" }, 404);
  if (inv.status === "paid") await unpay(env, inv);
  await env.DB.prepare("DELETE FROM invoices WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function share(env, id, on, origin) {
  const inv = await env.DB.prepare("SELECT share_token FROM invoices WHERE id = ?").bind(id).first();
  if (!inv) return json({ ok: false, error: "not_found" }, 404);
  let token = inv.share_token;
  if (on && !token) { token = randomToken(24); await env.DB.prepare("UPDATE invoices SET share_token = ? WHERE id = ?").bind(token, id).run(); }
  if (!on) { token = null; await env.DB.prepare("UPDATE invoices SET share_token = NULL WHERE id = ?").bind(id).run(); }
  return json({ ok: true, url: token ? `${origin}/invoice/${token}` : null });
}

/* ---------- the PDF ---------- */

let markCache = null;
async function loadMark(env, origin) {
  if (markCache) return markCache;
  try {
    const res = await env.ASSETS.fetch(new Request(origin + "/admin/img/invoice-mark.jpg"));
    if (res.ok) markCache = new Uint8Array(await res.arrayBuffer());
  } catch { /* the invoice still renders without the photo */ }
  return markCache;
}

export function renderInvoicePdf(invRow, biz, markBytes) {
  const inv = withTotals(invRow);
  const t = inv.totals;
  const cur = inv.currency;
  const money = (c) => formatMoney(c, cur);
  const doc = new Pdf({ title: `Invoice ${inv.number}`, author: biz.name, subject: `Invoice for ${inv.client_name || "client"}` });
  const mark = markBytes ? doc.jpeg(markBytes) : null;
  const PW = 595.28, PH = 841.89, M = 48, R = PW - M;
  const INK = "#141416", SOFT = "#55555c", MUTE = "#8a8b90", LINE = "#e4e4e7", PAPER = "#f6f5f2", TERRA = "#b5481e", BLACK = "#0a0a0b";
  let page = doc.page(PW, PH);
  let y = 0;

  const label = (str, x, yy, align = "left", color = MUTE) => page.text(str.toUpperCase(), x, yy, { font: "F2", size: 7, color, spacing: 1.4, align });
  const footer = (p) => {
    p.line(M, PH - 58, R, PH - 58, { color: LINE, width: 0.8 });
    p.text("Thank you — make music with purpose.", M, PH - 38, { font: "F4", size: 10, color: SOFT });
    p.text([biz.website, biz.email].filter(Boolean).join("  ·  "), R, PH - 38, { size: 8, color: MUTE, align: "right" });
  };
  const header = () => {
    page.rect(0, 0, PW, 164, { fill: BLACK });
    page.rect(0, 164, PW, 3.5, { fill: TERRA });
    let tx = M;
    // the website's share image (what WhatsApp shows for manuchie.org), as a portrait card
    if (mark) {
      const ih = 112, iw = Math.round((ih * mark.width) / mark.height);
      page.image(mark, M, 26, iw, ih, { radius: 10 });
      tx = M + iw + 22;
    }
    page.text(biz.name, tx, 78, { font: "F3", size: 28, color: "#ffffff" });
    if (biz.tagline) page.text(biz.tagline.toUpperCase(), tx, 97, { size: 7, color: "#a6a7ac", spacing: 1.5 });
    page.text([biz.website, biz.phone].filter(Boolean).join("   ·   "), tx, 116, { size: 8.5, color: "#d6d6da" });
    page.text("INVOICE", R, 70, { font: "F2", size: 8, color: "#c9cace", spacing: 3, align: "right" });
    page.text(inv.number, R, 98, { font: "F3", size: 22, color: "#ffffff", align: "right" });
    const stamp = { paid: "PAID", void: "VOID", overdue: "OVERDUE", draft: "DRAFT" }[inv.display_status];
    if (stamp) {
      const w = textWidth(stamp, "F2", 7.5) + 7.5 * 1.4 * (stamp.length - 1) + 20;
      page.rect(R - w, 110, w, 18, { fill: inv.display_status === "paid" ? "#ffffff" : inv.display_status === "overdue" ? TERRA : "#26262a", radius: 9 });
      page.text(stamp, R - w / 2, 122.5, { font: "F2", size: 7.5, color: inv.display_status === "paid" ? BLACK : "#ffffff", spacing: 1.4, align: "center" });
    }
  };
  const smallHeader = () => {
    page.rect(0, 0, PW, 6, { fill: TERRA });
    page.text(biz.name, M, 40, { font: "F3", size: 14, color: INK });
    page.text(`Invoice ${inv.number} — continued`, R, 40, { size: 8.5, color: MUTE, align: "right" });
    y = 72;
  };
  const room = (need) => { if (y + need > PH - 80) { footer(page); page = doc.page(PW, PH); smallHeader(); return true; } return false; };

  header();
  // ---- parties and dates
  y = 206;
  const col2 = M + 196;
  label("Billed to", M, y);
  label("From", col2, y);
  label("Issued", R, y, "right");
  let yl = y + 18, ym = y + 18;
  const lines = (arr, x, yy, first) => {
    arr.filter(Boolean).forEach((s, i) => {
      for (const ln of wrapText(s, i === 0 && first ? "F2" : "F1", i === 0 && first ? 11 : 9, 180)) {
        page.text(ln, x, yy, { font: i === 0 && first ? "F2" : "F1", size: i === 0 && first ? 11 : 9, color: i === 0 ? INK : SOFT });
        yy += i === 0 && first ? 15 : 12.5;
      }
    });
    return yy;
  };
  yl = lines([inv.client_name || "—", inv.client_company, inv.client_email, inv.client_phone, ...String(inv.client_address || "").split("\n")], M, yl, true);
  ym = lines([biz.legal_name || biz.name, ...String(biz.address || "").split("\n"), biz.email, biz.phone, biz.tax_number ? `${biz.tax_label || "Tax no."} ${biz.tax_number}` : ""], col2, ym, true);
  page.text(formatDay(inv.issue_date), R, y + 18, { size: 9.5, color: INK, align: "right" });
  label("Due", R, y + 40, "right");
  page.text(formatDay(inv.due_date), R, y + 58, { size: 9.5, color: inv.display_status === "overdue" ? TERRA : INK, align: "right" });
  if (inv.project_title) { label("Project", R, y + 80, "right"); page.text(inv.project_title.length > 34 ? inv.project_title.slice(0, 33) + "…" : inv.project_title, R, y + 98, { size: 9.5, color: INK, align: "right" }); }

  // ---- amount due callout
  y = Math.max(yl, ym, y + 104) + 12;
  page.rect(M, y, R - M, 64, { fill: PAPER, radius: 10 });
  label(inv.status === "paid" ? "Paid in full" : "Amount due", M + 18, y + 24, "left", SOFT);
  page.text(inv.status === "paid" ? `Received ${formatDay((inv.paid_at || "").slice(0, 10))}` : inv.due_date ? `by ${formatDay(inv.due_date)}` : "on receipt", M + 18, y + 44, { size: 9.5, color: SOFT });
  page.text(money(t.total), R - 18, y + 44, { font: "F3", size: 26, color: INK, align: "right" });
  y += 84;

  // ---- line items
  const cQty = 382, cRate = 464, descW = cQty - 60 - M - 8;
  const tableHead = () => {
    page.rect(M, y, R - M, 24, { fill: BLACK, radius: 6 });
    const hy = y + 15.5;
    page.text("DESCRIPTION", M + 12, hy, { font: "F2", size: 7, color: "#e9e9eb", spacing: 1.2 });
    page.text("QTY", cQty, hy, { font: "F2", size: 7, color: "#e9e9eb", spacing: 1.2, align: "right" });
    page.text("RATE", cRate, hy, { font: "F2", size: 7, color: "#e9e9eb", spacing: 1.2, align: "right" });
    page.text("AMOUNT", R - 12, hy, { font: "F2", size: 7, color: "#e9e9eb", spacing: 1.2, align: "right" });
    y += 24;
  };
  tableHead();
  const items = t.items.filter((it) => it.description || it.unit_cents);
  if (!items.length) { page.text("No items yet.", M + 12, y + 22, { size: 10, color: MUTE }); y += 36; }
  for (const it of items) {
    const ls = wrapText(it.description || "—", "F1", 10, descW);
    const rowH = Math.max(1, ls.length) * 13.5 + 16;
    if (room(rowH)) tableHead();
    ls.forEach((ln, i) => page.text(ln, M + 12, y + 20 + i * 13.5, { size: 10, color: INK }));
    const q = Number.isInteger(it.qty) ? String(it.qty) : it.qty.toFixed(2).replace(/0$/, "");
    page.text(q, cQty, y + 20, { size: 10, color: SOFT, align: "right" });
    page.text(money(it.unit_cents), cRate, y + 20, { size: 10, color: SOFT, align: "right" });
    page.text(money(Math.round(it.qty * it.unit_cents)), R - 12, y + 20, { font: "F2", size: 10, color: INK, align: "right" });
    y += rowH;
    page.line(M, y, R, y, { color: LINE, width: 0.7 });
  }

  // ---- totals (right) beside payment details (left)
  const bankLines = biz.bank ? wrapText(biz.bank, "F1", 9, 300 - M - 36 + 24) : [];
  room(Math.max(130, bankLines.length * 12.5 + 56));
  y += 16;
  const tl = 340;
  const yTop = y;
  let bankBottom = null;
  if (bankLines.length) {
    const bw = tl - 24 - M, bh = bankLines.length * 12.5 + 44;
    page.rect(M, yTop - 4, bw, bh, { fill: PAPER, radius: 10 });
    label("Payment details", M + 16, yTop + 16, "left", SOFT);
    bankLines.forEach((ln, i) => page.text(ln, M + 16, yTop + 33 + i * 12.5, { size: 9, color: INK }));
    bankBottom = yTop - 4 + bh;
  }
  const trow = (k, v, { bold = false } = {}) => {
    page.text(k, tl, y, { font: bold ? "F2" : "F1", size: bold ? 10.5 : 9.5, color: bold ? INK : SOFT });
    page.text(v, R - 12, y, { font: bold ? "F2" : "F1", size: bold ? 10.5 : 9.5, color: INK, align: "right" });
    y += 18;
  };
  trow("Subtotal", money(t.subtotal));
  if (t.discount) trow("Discount", "– " + money(t.discount));
  if (inv.tax_bp) trow(`${inv.tax_label || "Tax"} (${(inv.tax_bp / 100).toString()}%)`, money(t.tax));
  page.line(tl, y - 6, R, y - 6, { color: LINE, width: 0.7 });
  y += 6;
  page.rect(tl - 12, y - 4, R - tl + 12, 34, { fill: inv.status === "paid" ? "#ffffff" : BLACK, stroke: inv.status === "paid" ? INK : undefined, lineWidth: 0.8, radius: 8 });
  page.text(inv.status === "paid" ? "PAID" : "BALANCE DUE", tl, y + 17, { font: "F2", size: 8, color: inv.status === "paid" ? INK : "#e9e9eb", spacing: 1.4 });
  page.text(inv.status === "paid" ? money(0) : money(t.total), R - 12, y + 18.5, { font: "F2", size: 13, color: inv.status === "paid" ? INK : "#ffffff", align: "right" });
  y += 44;
  if (bankBottom !== null) y = Math.max(y, bankBottom + 14);

  // ---- notes
  const block = (title, body) => {
    if (!body) return;
    const ls = wrapText(body, "F1", 9.5, R - M - 36);
    const h = ls.length * 13.5 + 40;
    room(h + 10);
    page.rect(M, y, R - M, h, { fill: PAPER, radius: 10 });
    label(title, M + 18, y + 22, "left", SOFT);
    ls.forEach((ln, i) => page.text(ln, M + 18, y + 40 + i * 13.5, { size: 9.5, color: INK }));
    y += h + 14;
  };
  block("Notes", inv.notes);
  footer(page);
  return doc.bytes();
}

async function pdfResponse(env, inv, origin, { inline }) {
  const biz = await getBusiness(env);
  const bytes = renderInvoicePdf(inv, biz, await loadMark(env, origin));
  const name = `Invoice-${inv.number}${inv.client_name ? "-" + inv.client_name : ""}.pdf`.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-");
  return new Response(bytes, {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "X-Frame-Options": "SAMEORIGIN",
      // only framing is restricted: a stricter policy stops some browsers' built-in PDF viewers
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
}

/* Public share link: anyone with the (unguessable) link sees the PDF. */
export async function handlePublicInvoice(request, env, token) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token || "")) return new Response("Not found", { status: 404, headers: PRIVATE_HEADERS });
  const inv = await env.DB.prepare("SELECT i.*, p.title AS project_title FROM invoices i LEFT JOIN projects p ON p.id = i.project_id WHERE i.share_token = ?").bind(token).first();
  if (!inv) return new Response("This invoice link is no longer active.", { status: 404, headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  const url = new URL(request.url);
  return pdfResponse(env, inv, url.origin, { inline: url.searchParams.get("download") !== "1" });
}

/* ---------- router ---------- */

export async function handleInvoiceApi(request, env, parts, currency) {
  const url = new URL(request.url);
  const m = request.method;
  const [resource, id, sub] = parts;
  if (resource === "business" && m === "GET") return json({ business: await getBusiness(env) });
  if (resource === "business" && m === "POST") {
    const { data = {} } = await readBody(request, 20000);
    const r = await saveBusiness(env, data);
    return r.error || json({ ok: true, business: r.business });
  }
  if (resource !== "invoices") return null;
  if (!id && m === "GET") return listInvoices(env, url.searchParams);
  if (!id && m === "POST") return createInvoice(env, request, currency);
  if (!uuid(id)) return null;
  if (!sub && m === "GET") return getInvoice(env, id);
  if (!sub && m === "PATCH") return updateInvoice(env, id, request);
  if (!sub && m === "DELETE") return deleteInvoice(env, id);
  if (sub === "paid" && m === "POST") return markPaid(env, id, request);
  if (sub === "duplicate" && m === "POST") return duplicateInvoice(env, id);
  if (sub === "share" && m === "POST") return share(env, id, true, url.origin);
  if (sub === "share" && m === "DELETE") return share(env, id, false, url.origin);
  if (sub === "pdf" && m === "GET") {
    const inv = await env.DB.prepare("SELECT i.*, p.title AS project_title FROM invoices i LEFT JOIN projects p ON p.id = i.project_id WHERE i.id = ?").bind(id).first();
    if (!inv) return json({ ok: false, error: "not_found" }, 404);
    return pdfResponse(env, inv, url.origin, { inline: url.searchParams.get("inline") === "1" });
  }
  return null;
}
