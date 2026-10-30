/* Unit tests for the Worker's pure logic. Run: npm test  (node --test worker/test/) */

import { test } from "node:test";
import assert from "node:assert/strict";
import { clean, isEmail, stripUrl, refHost, isBot, deviceOf, toCsv, parseTags, parseRange, daysBetween, linkCount, parseMoney, isDay } from "../src/lib/text.js";
import { hashPassword, verifyPassword, safeEqual, toB64Url, fromB64Url } from "../src/lib/crypto.js";
import { validateEnquiry, spamReason } from "../src/enquiry.js";
import { parseEvent } from "../src/collect.js";
import { readFileSync } from "node:fs";
import { encodeWinAnsi, textWidth, wrapText, jpegInfo, Pdf } from "../src/lib/pdf.js";
import { invoiceTotals, formatMoney, formatDay, renderInvoicePdf, DEFAULT_BUSINESS } from "../src/invoices.js";

test("clean strips control and bidi characters, collapses whitespace on one line", () => {
  assert.equal(clean("  Ada\u0000 ‮ Lovelace \n", 50), "Ada Lovelace");
  assert.equal(clean("line one\r\nline two\u0007", 50, { multiline: true }), "line one\nline two");
  assert.equal(clean("x".repeat(10), 4), "xxxx");
  assert.equal(clean(undefined, 10), "");
});

test("email validation", () => {
  for (const ok of ["a@b.co", "first.last+tag@sub.example.org"]) assert.ok(isEmail(ok), ok);
  for (const bad of ["", "a@b", "a@@b.com", "a..b@c.com", "<x>@y.com", "a@b.com\n"]) assert.ok(!isEmail(bad), bad);
});

test("URLs keep only origin and path; referrer hosts drop www and own host", () => {
  assert.equal(stripUrl("https://l.instagram.com/?u=secret#x"), "https://l.instagram.com/");
  assert.equal(stripUrl("javascript:alert(1)"), "");
  assert.equal(refHost("https://www.google.com/search?q=x"), "google.com");
  assert.equal(refHost("https://manuchie.org/#contact", ["manuchie.org"]), null);
  assert.equal(refHost("https://www.manuchie.org/", ["www.manuchie.org"]), null);
  assert.equal(refHost("not a url"), null);
});

test("bot and device detection", () => {
  assert.ok(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)"));
  assert.ok(isBot("Mozilla/5.0 HeadlessChrome/120"));
  assert.ok(isBot(""));
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
  assert.ok(!isBot(iphone) && !isBot(mac));
  assert.equal(deviceOf(iphone), "mobile");
  assert.equal(deviceOf(ipad), "tablet");
  assert.equal(deviceOf(mac), "desktop");
  assert.equal(deviceOf(mac, 390), "mobile");
});

test("CSV escapes quotes and neutralises spreadsheet formulas", () => {
  const out = toCsv([{ a: '=HYPERLINK("x")', b: 'He said "hi", twice\nok' }], [{ label: "A", key: "a" }, { label: "B", key: "b" }]);
  assert.equal(out, '\uFEFFA,B\r\n"\'=HYPERLINK(""x"")","He said ""hi"", twice\nok"\r\n');
});

test("tags are cleaned, lower-cased and unique", () => {
  assert.deepEqual(parseTags("Church, church ,  Label,,"), ["church", "label"]);
  assert.deepEqual(parseTags(["A", "b", "a"]), ["a", "b"]);
});

test("date ranges and previous period", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const r7 = parseRange(new URLSearchParams("range=7d"), now);
  assert.deepEqual(r7, { from: "2026-10-23", to: "2026-10-29", prevFrom: "2026-10-16", prevTo: "2026-10-22", days: 7 });
  const today = parseRange(new URLSearchParams("range=today"), now);
  assert.equal(today.from, "2026-10-29"); assert.equal(today.prevFrom, "2026-10-28");
  const custom = parseRange(new URLSearchParams("range=custom&from=2026-10-10&to=2026-10-01"), now);
  assert.equal(custom.from, "2026-10-01"); assert.equal(custom.to, "2026-10-10"); assert.equal(custom.days, 10);
  assert.equal(parseRange(new URLSearchParams("range=custom&from=bad&to=2026-10-01"), now).days, 30);
  assert.deepEqual(daysBetween("2026-10-30", "2026-11-01"), ["2026-10-30", "2026-10-31", "2026-11-01"]);
});

test("passwords: PBKDF2 round trip, wrong password and tampered hash fail", async () => {
  const h = await hashPassword("correct horse battery staple", 1000);
  assert.match(h, /^pbkdf2_sha256\$1000\$[\w-]+\$[\w-]+$/);
  assert.ok(await verifyPassword("correct horse battery staple", h));
  assert.ok(!(await verifyPassword("correct horse battery stapl", h)));
  assert.ok(!(await verifyPassword("x", h.replace("$1000$", "$999999$"))));
  assert.ok(!(await verifyPassword("x", "plain")));
  assert.ok(safeEqual("abc", "abc") && !safeEqual("abc", "abd") && !safeEqual("abc", "ab"));
  const bytes = new Uint8Array([0, 255, 128, 7]);
  assert.deepEqual(fromB64Url(toB64Url(bytes)), bytes);
});

test("enquiry validation and spam rules", () => {
  const good = validateEnquiry({ name: " Ada ", email: "ada@example.com", message: "A worship EP\r\nin March", marketing_consent: "on", source_page: "/" });
  assert.ok(good.ok);
  assert.equal(good.value.name, "Ada");
  assert.equal(good.value.message, "A worship EP\nin March");
  assert.equal(good.value.marketing_consent, true);
  const bad = validateEnquiry({ name: "", email: "nope", message: "   " });
  assert.deepEqual(Object.keys(bad.fields).sort(), ["email", "message", "name"]);
  assert.equal(validateEnquiry({ name: "a", email: "a@b.co", message: "m", source_page: "https://evil" }).value.source_page, "/");

  const now = 1_000_000;
  assert.equal(spamReason({ botcheck: true, message: "" }, now), "honeypot");
  assert.equal(spamReason({ botcheck: false, started_at: now - 1000, message: "hi" }, now), "too_fast");
  assert.equal(spamReason({ botcheck: false, started_at: now - 9000, message: "hi" }, now), null);
  assert.equal(spamReason({ botcheck: false, started_at: null, message: "http://a http://b www.c https://d" }, now), "links");
  assert.equal(linkCount("see https://x and www.y"), 2);
});

test("analytics events are whitelisted", () => {
  assert.deepEqual(parseEvent({ type: "click", name: "spotify", path: "/?utm_source=x#sound", sid: "abc_123", w: 390 }).path, "/");
  assert.equal(parseEvent({ type: "click", name: "evil" }), null);
  assert.equal(parseEvent({ type: "section_view", name: "nope" }), null);
  assert.equal(parseEvent({ type: "keystroke" }), null);
  assert.equal(parseEvent({ type: "pageview", name: "ignored", path: "//evil.com" }).name, null);
  assert.equal(parseEvent({ type: "pageview", path: "//evil.com" }).path, "/");
  assert.equal(parseEvent({ type: "form_start", sid: "<script>" }).sid, "script");
});

test("money typed by a person becomes whole cents; nonsense is refused", () => {
  assert.equal(parseMoney("1,250.50"), 125050);
  assert.equal(parseMoney("R 900"), 90000);
  assert.equal(parseMoney("$12.5"), 1250);
  assert.equal(parseMoney(1200), 120000);
  assert.equal(parseMoney("2,500"), 250000);
  assert.equal(parseMoney("0"), 0);
  for (const bad of ["abc", "-5", "12.345", "", null, -3, Infinity]) assert.equal(parseMoney(bad), null, String(bad));
});

test("dates must be real calendar days", () => {
  assert.ok(isDay("2026-10-30") && isDay("2028-02-29"));
  for (const bad of ["2026-02-30", "2026-13-01", "30/10/2026", "", null]) assert.ok(!isDay(bad), String(bad));
});

/* ---------- invoices and the PDF writer ---------- */

test("invoice totals: lines, then discount, then tax on what's left", () => {
  const items = [{ description: "Production", qty: 2, unit_cents: 100000 }, { description: "Mix", qty: 1.5, unit_cents: 20000 }];
  assert.deepEqual(
    (({ subtotal, discount, tax, total }) => ({ subtotal, discount, tax, total }))(invoiceTotals({ items: JSON.stringify(items), discount_cents: 10000, tax_bp: 1500 })),
    { subtotal: 230000, discount: 10000, tax: 33000, total: 253000 });
  // a discount can't push the invoice below zero, and bad stored JSON counts as no lines
  assert.equal(invoiceTotals({ items, discount_cents: 999999, tax_bp: 1500 }).total, 0);
  assert.equal(invoiceTotals({ items: "{oops", discount_cents: 0, tax_bp: 0 }).total, 0);
  assert.equal(invoiceTotals({ items: [{ qty: 3, unit_cents: 333 }], tax_bp: 1250 }).total, 999 + 125);
});

test("money and dates read the way a client expects", () => {
  assert.equal(formatMoney(534750, "USD"), "$5,347.50");
  assert.equal(formatMoney(-25000, "USD"), "-$250.00");
  assert.equal(formatMoney(100000, "ZAR"), "R1,000.00");
  assert.match(formatMoney(100, "XYZ"), /^XYZ 1\.00$/);
  assert.equal(formatDay("2026-10-30"), "30 Oct 2026");
  assert.equal(formatDay(null), "—");
});

test("PDF text: WinAnsi encoding, widths and wrapping", () => {
  assert.deepEqual(encodeWinAnsi("A€–é"), [65, 0x80, 0x96, 0xe9]);
  assert.deepEqual(encodeWinAnsi("✓"), [63]);
  assert.equal(textWidth("Hello", "F1", 10), (722 + 556 + 222 + 222 + 556) / 100);
  assert.ok(textWidth("WWW", "F2", 12) > textWidth("iii", "F2", 12));
  const lines = wrapText("one two three four five six seven", "F1", 10, 60);
  assert.ok(lines.length > 1 && lines.every((l) => textWidth(l, "F1", 10) <= 60), lines.join("|"));
  assert.deepEqual(wrapText("a\n\nb", "F1", 10, 100), ["a", "", "b"]);
  // a single word longer than the line is split rather than overflowing
  assert.ok(wrapText("x".repeat(80), "F1", 10, 50).every((l) => textWidth(l, "F1", 10) <= 50));
});

test("JPEG size is read from the file header", () => {
  const info = jpegInfo(new Uint8Array(readFileSync(new URL("../../admin/img/invoice-mark.jpg", import.meta.url))));
  assert.deepEqual(info, { width: 280, height: 280, components: 3 });
  assert.throws(() => jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), /not a JPEG/);
});

/* Every object the cross-reference table lists must start exactly where it says. */
function checkXref(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  assert.ok(text.startsWith("%PDF-1.4") && text.trimEnd().endsWith("%%EOF"));
  const start = Number(text.match(/startxref\s+(\d+)\s+%%EOF\s*$/)[1]);
  assert.equal(text.slice(start, start + 4), "xref");
  const [, first, count] = text.slice(start).match(/^xref\s+(\d+) (\d+)/);
  const rows = text.slice(start).split(/\r?\n/).slice(2, 2 + Number(count));
  rows.forEach((row, i) => {
    if (i + Number(first) === 0) return;
    const off = Number(row.slice(0, 10));
    assert.ok(text.startsWith(`${i + Number(first)} 0 obj`, off), `object ${i} at ${off}`);
  });
  return text;
}

test("the PDF writer produces a valid file", () => {
  const doc = new Pdf({ title: "T (1)", author: "A" });
  const p = doc.page();
  p.rect(10, 10, 100, 50, { fill: "#000000", radius: 6 }).line(0, 0, 50, 50);
  p.text("Brackets (and \\ slashes) – €5", 20, 100);
  checkXref(doc.bytes());
});

test("an invoice renders to a one-page PDF with the photo, the lines and the totals", () => {
  const mark = new Uint8Array(readFileSync(new URL("../../admin/img/invoice-mark.jpg", import.meta.url)));
  const inv = { number: "MAN-2026-007", status: "sent", issue_date: "2026-10-01", due_date: "2026-10-15", currency: "USD",
    client_name: "Grace Ndlovu", client_company: "Harvest Church", client_email: "grace@example.test", client_address: "12 Samora Machel Ave\nHarare",
    items: JSON.stringify([{ description: "Album production — 10 songs", qty: 1, unit_cents: 450000 }, { description: "Strings arrangement", qty: 2, unit_cents: 20000 }]),
    discount_cents: 25000, tax_bp: 1500, tax_label: "VAT", notes: "Thank you!" };
  const text = checkXref(renderInvoicePdf(inv, { ...DEFAULT_BUSINESS, bank: "CBZ Bank\nAccount 0123" }, mark));
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 1);
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /\(MAN-2026-007\)/);
  assert.match(text, /\(\$5,347.50\)/);
  assert.match(text, /\(Grace Ndlovu\)/);
  // and without the photo, it still renders
  checkXref(renderInvoicePdf({ ...inv, status: "paid", paid_at: "2026-10-20T10:00:00Z" }, DEFAULT_BUSINESS, null));
});
