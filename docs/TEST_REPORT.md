# Test report — Manuchie rebuild

29 October 2026. Live at **https://manuchie.org** (Worker `manuchie`, version
`142be17a-9123-49ff-b7fb-2cf07fdc5c88`, Manuchie01@gmail.com's Cloudflare account).
Dashboard: **https://manuchie.org/admin/login**.

## Dashboard rework (after first use)

Feedback from the first real enquiry: no obvious way to open, edit, mark read or complete, and the
marketing-consent page wasn't useful. Changes: inbox views (To reply · In progress · Booked ·
Complete · All · Spam) with counts; whole rows open the enquiry; per-row **Mark read / unread**
and **Complete / Reopen**; a bulk bar (mark read, complete, spam, export, delete); search covers
the message text; the enquiry page has Reply by email (pre-filled, quoting their message),
Mark replied, Mark complete, Booked, Mark unread, a status picker, **Edit** for name and email
(the contact follows; duplicates are merged safely), notes and earlier enquiries from the same
person; the overview leads with To reply / In progress / Booked and a "Needs your attention"
list. The Marketing consent page is gone: consent is still recorded, shown as "Mailing list" on
contacts, with an "Export mailing list" button on Contacts.

## Studio desk (30 Oct)

Projects (lead → booked → in progress → final touches → completed, plus on hold / cancelled) with
type, client, dates, agreed fee, to-dos (progress follows them) and notes; Money (income received
and expected, expenses by category, profit, still to invoice, 12-month chart, CSV); Clients added
by hand with phone and company, Email / Call / WhatsApp buttons; "Start a project" from an
enquiry; studio currency in Settings; phone navigation Home · Enquiries · Projects · Money · More.
Backend checks for all of it are in `integration.mjs` (110 checks in total). Every dashboard screen
was rendered offscreen at 390/768/1024/1440 with sample data (54 renders: no overflow, no script
errors, no axe violations) using `worker/test/offscreen/` — WebKit in a hidden window, no browser.
A unit test caught an impossible-month date crashing the date check; fixed.

## Invoices and editable lists (30 Oct)

Invoices: create from a project (the remaining fee and the client are filled in) or from scratch;
client details are copied onto the invoice; line items with live totals, discount, tax; autosave
with a live PDF preview; Download PDF; Email to client (a private link in a pre-written email);
Copy link / Turn off link; Mark as sent / paid / unpaid (paying logs the income in Money, reusing
a matching expected payment so nothing is counted twice); Duplicate; Void; Delete (undoes its
payment). Numbering is PREFIX-YEAR-### and restarts each year. The PDF is written by a small
dependency-free PDF writer (`worker/src/lib/pdf.js`): A4, his circular photo, standard fonts with
real widths for wrapping and alignment. Settings gained Invoice details (name, contact, tax number,
bank details, terms, prefix, due days, default tax) and **Your lists** — project types, expense and
income categories and stage names are all editable. Projects can add a new client in place, or
edit, change or unlink theirs; money entries and to-dos are editable in place. A client's data
export now includes their invoices.

Checks: 28 new backend checks (138 in total), 7 new unit tests (PDF text encoding, widths and
wrapping, JPEG header, a cross-reference table that points at every object, a full invoice render,
totals and money formatting). All 62 offscreen renders (now including Invoices and an invoice) are
clean — no overflow, no script errors, no axe violations; the first pass caught the phone layout
running 167px wide, unstyled selects and phone fields, and a total that was invisible on its white
bar — all fixed. Sample PDFs (fake details): `docs/qa/invoice-sample.pdf`, `invoice-sample-paid.pdf`.

## Results

| Suite | What it covers | Result |
|---|---|---|
| Unit — `npm test` | validation, spam rules, PBKDF2, CSV formula safety, bot/device detection, date ranges, event whitelist | **18 / 18** |
| Backend end-to-end — `worker/test/integration.mjs` | enquiry API (origin, validation, size, rate limit, honeypot, no-JS), email via a mock Resend, analytics beacons (bots, other origins, admins excluded), sign-in, cookie flags, CSRF, every dashboard API incl. editing name/email (contact kept in step, duplicate emails refused), status-list filters, message search, bulk complete/delete, CSV/JSON exports, consent, erasure, password rules, lockout, logout, logs free of message text; projects, money, editable lists, invoice details; invoices end to end (numbering, totals, validation, PDF download, share link on/off, paid/unpaid with Money, duplicate, delete) | **138 / 138** |
| Browser end-to-end — `worker/test/site-e2e.mjs` | the real page against the real Worker: text logo, robots; UTM landing, section views once each, Spotify click, form start once, enquiry sent in-page with no email app, form cleared; no-JavaScript post; the admin dashboard then shows exactly that visit, click, funnel, campaign, device, enquiry and consent wording; no overflow at 390/768/1024/1440 | **26 / 26** |
| Dashboard visual + accessibility — `worker/test/dashboard-qa.mjs` | every dashboard page at 390/768/1024/1440, axe-core (WCAG 2.2 AA) at 390 and 1440, console errors, mobile menu focus and Escape, skip link | **No overflow, no console errors, no axe violations** |
| Public site QA (public-site pass) | content lock, layout at four widths, anchors, keyboard, reduced motion, touch targets, form states | see `docs/PUBLIC_SITE_CHANGES.md` |
| Live checks after deploy | page, favicons, manifest, robots, sign-in page, `/admin/` gate; one test event and one test enquiry reached the production database and were then deleted | **pass** (production holds 0 test rows) |

## Lighthouse

| Where | Mode | Performance | Accessibility | Best Practices | SEO |
|---|---|---|---|---|---|
| **Live manuchie.org** (median of 3) | mobile | **95** | **100** | **100** | **100** |
| **Live manuchie.org** | desktop | **99** | **100** | **100** | **100** |
| Local build (public-site pass, median of 5) | mobile / desktop | 100 / 100 | 100 / 100 | 100 / 100 | 100 / 100 |

Reports: `docs/qa/live-lighthouse-mobile.report.html`, `docs/qa/live-lighthouse-desktop.report.html`.
Live mobile LCP 2.7 s, CLS 0, TBT 0 ms (Lighthouse's simulated slow 4G, run from Zimbabwe).

Two live-only fixes made after the first deploy:

1. **Cloudflare was injecting its own Web Analytics script** into the HTML. The CSP blocked it
   (console error, Best Practices 93). `Cache-Control: no-transform` on HTML now stops the
   injection → Best Practices 100, and no third-party script runs on the page.
2. **Newsreader font files trimmed** to the weights (400–700) and optical sizes (12–72) the site
   uses: the two first-screen files fell from 279 KB to 194 KB. A pixel comparison of full-page
   renders before and after showed only anti-aliasing noise on the hero heading (1 pixel at 390 px,
   388 sub-pixel edge pixels of 48 million at 1440 px). Mobile Performance 87 → 95.

## Screenshots (`docs/qa/`)

- Public site: `public-390.jpg`, `public-768.jpg`, `public-1024.jpg`, `public-1440.jpg` (full page)
  and `public-top-*.jpg` (first screen); `public-form-sent-1440.jpg`; `public-player-*.png`
  (Spotify embed working).
- Dashboard: `dashboard-<page>-<width>.png` for login, overview, analytics, enquiries, an
  enquiry, contacts, a contact and settings at 390/768/1024/1440, plus
  `dashboard-menu-390.png` and `dashboard-enquiries-e2e-1440.jpg`. Dashboard screenshots use
  clearly fake sample data (`example.test` addresses) in a throwaway local database.

## Content lock

Verified twice, independently: the visible text of the old and new page, word by word; image
order; every external link. The only text added is the optional marketing-consent label (the
brief allows it); the footer year is now also written into the HTML (it was filled in by
script). All 9 photographs are in the same order and all 19 external links are unchanged.
Photo alt text was rewritten to describe each picture (listed in `PUBLIC_SITE_CHANGES.md`).
The Hallmark logo was added after approval and then removed at the client's request; the header
and footer show the original "Manuchie" text and the original favicon. New symbol-only mark
proposals are in progress in `brand/v2/` (not live).

## Deliverables

1. Source: `index.html`, `styles.css`, `script.js`, `fonts.css`, `_headers`, `build.sh`,
   `worker/`, `admin/`, `migrations/`, `scripts/`, `wrangler.jsonc`, `package.json`.
2. Logo assets: `brand/` (three concepts; Hallmark production package in `brand/package/`).
3. Changed and created files: `git status` (public-site detail in `PUBLIC_SITE_CHANGES.md`).
4. Database schema and migrations: `migrations/0001_init.sql`.
5. Environment template: `.dev.vars.example`.
6. Setup and deployment: `docs/DEPLOYMENT.md`.
7. Admin setup: `docs/DEPLOYMENT.md` §4 (`scripts/create-admin.mjs`).
8. Email service: `docs/DEPLOYMENT.md` §2 (Resend).
9. Test report: this file.
10. Lighthouse reports: `docs/qa/live-lighthouse-*.report.html`, `docs/qa/public-lighthouse-*`.
11. Screenshots at all four widths: `docs/qa/`.
12. Security and privacy checklist: `docs/SECURITY_PRIVACY.md`.
13. Content-lock confirmation: above, and `docs/qa/public-content-lock.json`.
14. Still needs the owner — below.

## Still needs the owner

- **Email delivery.** Create a Resend account, verify `manuchie.org` (DNS records), and set
  `MAIL_TO`, `MAIL_FROM`, `RESEND_API_KEY` (`docs/DEPLOYMENT.md` §2). Until then enquiries are
  saved in the dashboard but not emailed.
- **Change the dashboard password.** It was shown on screen and saved in the shell history
  during setup. Use **Settings → Change password**.
- **Optional daily cron.** Open Workers & Pages once in Manuchie's Cloudflare dashboard, then
  uncomment `triggers` in `wrangler.jsonc` (housekeeping already runs without it).
- **Cultural and scripture references in the Hallmark seal** (Great Zimbabwe chevron,
  "Play skilfully") — confirm with Manuchie.
- **Share image.** It stays the 536×640 portrait; a 1200×630 crop would show better on social
  platforms (needs a new image, so it needs approval).
- **Nothing is committed to git.** The pre-rebuild state is tagged
  `backup/pre-rebuild-2026-10-29`.
