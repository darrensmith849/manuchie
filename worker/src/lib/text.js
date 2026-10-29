/* Input cleaning, validation, CSV and visitor classification. Pure functions (unit-tested). */

/* Strip control characters (keeping newlines and tabs), normalise newlines and trim. */
export function clean(value, max, { multiline = false } = {}) {
  if (value === undefined || value === null) return "";
  let s = String(value).normalize("NFC").replace(/\r\n?/g, "\n");
  s = s.replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g
                          : /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "");
  if (!multiline) s = s.replace(/\s+/g, " ");
  else s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n");
  s = s.trim();
  return s.length > max ? s.slice(0, max) : s;
}

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const isEmail = (s) => s.length <= 254 && EMAIL_RE.test(s) && !s.includes("..");
export const normEmail = (s) => String(s || "").trim().toLowerCase();

export const truthy = (v) => v === true || v === "true" || v === "on" || v === "1" || v === 1 || v === "yes";

/* Keep only scheme, host and path of a URL (drops query strings and fragments). */
export function stripUrl(value, max = 500) {
  const s = clean(value, 2000);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return (u.origin + u.pathname).slice(0, max);
  } catch { return ""; }
}

export function refHost(ref, ownHosts = []) {
  try {
    const u = new URL(ref);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase().replace(/^(www|m|l|lm|mobile)\./, "");
    if (ownHosts.some((own) => h === own || h === own.replace(/^www\./, ""))) return null;
    return h.slice(0, 120);
  } catch { return null; }
}

export const BOT_RE = /bot|crawl|spider|slurp|scrape|fetch|monitor|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python|httpclient|okhttp|axios|go-http|java\/|phantom|puppeteer|playwright|selenium/i;
export const isBot = (ua) => !ua || BOT_RE.test(ua);

export function deviceOf(ua = "", width = 0) {
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return "mobile";
  if (width && width < 768) return "mobile";
  return "desktop";
}

/* Count links in free text (spam signal). */
export const linkCount = (s) => (String(s).match(/https?:\/\/|www\./gi) || []).length;

/* CSV with protection against spreadsheet formula injection. */
export function toCsv(rows, columns) {
  const cell = (v) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => cell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(typeof c.value === "function" ? c.value(r) : r[c.key])).join(","));
  return "\uFEFF" + [head, ...body].join("\r\n") + "\r\n";
}

/* Parse a tags value (array or comma-separated string) into a clean, unique list. */
export function parseTags(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const out = [];
  for (const t of list) {
    const tag = clean(t, 40).toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

/* Date ranges for the dashboard (UTC days). Returns { from, to, prevFrom, prevTo, days }. */
export function parseRange(params, now = new Date()) {
  const day = (d) => d.toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const preset = params.get("range") || "30d";
  let from, to;
  const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
  if (preset === "custom" && valid(params.get("from")) && valid(params.get("to"))) {
    from = new Date(params.get("from") + "T00:00:00Z");
    to = new Date(params.get("to") + "T00:00:00Z");
    if (from > to) [from, to] = [to, from];
    if ((to - from) / 86400000 > 731) from = addDays(to, -731);
  } else {
    const n = { today: 1, "7d": 7, "30d": 30, "90d": 90 }[preset] || 30;
    to = today;
    from = addDays(today, -(n - 1));
  }
  const days = Math.round((to - from) / 86400000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from: day(from), to: day(to), prevFrom: day(prevFrom), prevTo: day(prevTo), days };
}

/* Every day between two YYYY-MM-DD strings, inclusive. */
export function daysBetween(from, to) {
  const out = [];
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
