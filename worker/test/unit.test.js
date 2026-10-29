/* Unit tests for the Worker's pure logic. Run: npm test  (node --test worker/test/) */

import { test } from "node:test";
import assert from "node:assert/strict";
import { clean, isEmail, stripUrl, refHost, isBot, deviceOf, toCsv, parseTags, parseRange, daysBetween, linkCount } from "../src/lib/text.js";
import { hashPassword, verifyPassword, safeEqual, toB64Url, fromB64Url } from "../src/lib/crypto.js";
import { validateEnquiry, spamReason } from "../src/enquiry.js";
import { parseEvent } from "../src/collect.js";

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
