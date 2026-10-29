# Security and privacy checklist

## Dashboard access

- [x] No public registration; admins are created only with `scripts/create-admin.mjs`.
- [x] No default or hard-coded password; the password is typed locally and only a
      PBKDF2-SHA256 hash (100,000 iterations, random 16-byte salt) reaches the database.
- [x] Session cookie `__Host-mz_admin`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`,
      12-hour absolute expiry. The database stores only a SHA-256 hash of the token.
- [x] Logout deletes the session server-side; password change signs out other sessions.
- [x] Every state-changing dashboard call needs a same-origin `Origin` header **and** the
      session's CSRF token in `X-CSRF-Token`.
- [x] Login rate limiting: 5 failures per account or 10 per network in 15 minutes → 429.
      Unknown emails take as long as known ones (dummy hash check).
- [x] `/admin/*` and `/api/admin/*` are checked on the server before anything is served
      (`run_worker_first`); signed-out visitors get the login page or a 401.
- [x] Dashboard and API responses: `Cache-Control: no-store`, `X-Robots-Tag: noindex`,
      strict CSP (`script-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`.
- [x] No dashboard data in public HTML; the dashboard loads its data from the API after
      sign-in. Its code is separate from the public site's (`admin/` vs `script.js`).
- [x] All database values are inserted into the page as text (no `innerHTML`).

## Enquiry form

- [x] Server-side validation and cleaning (control/bidi characters stripped, length limits,
      20 KB body limit), parameterised SQL everywhere.
- [x] Same-origin check (no cross-site posting).
- [x] Rate limiting: 5 enquiries per 10 minutes and 20 per day per network (salted,
      daily-rotating IP hash; raw IPs are never stored).
- [x] Spam: hidden honeypot field, "filled in under 3 seconds" check, link-count check.
      Spam is stored as `spam` (visible in the dashboard, never emailed, no contact
      record) and gets the same success response, so bots learn nothing.
- [x] Email credentials are Worker secrets, never in the repository or the browser.
- [x] The visitor acknowledgement email never repeats the submitted message, so the form
      can't be used to send arbitrary text to someone else.
- [x] Message text is never written to logs or shown in analytics.
- [x] CSV exports neutralise spreadsheet formulas (`=`, `+`, `-`, `@` prefixed with `'`).

## Consent and personal data

- [x] Enquiries are transactional; nobody is added to marketing automatically.
- [x] Marketing needs the separate, unticked checkbox. Each opt-in stores the exact
      wording, time, method, page and a salted IP hash (`consent_records`, append-only).
- [x] Unsubscribe records a withdrawal; suppression excludes a contact from every
      marketing export regardless of consent.
- [x] The marketing export contains only opted-in, active, not-withdrawn contacts.
- [x] Right of access: per-contact JSON export. Right to erasure: deleting a contact
      removes them, their enquiries and their consent history.
- [x] One contact record per email address (unique normalised email).

## Analytics

- [x] First-party and cookie-free; nothing is stored on the visitor's device except a
      random per-tab id in `sessionStorage`.
- [x] No IP addresses, no precise location (country only), no form content, no browsing
      history, no cross-site identifiers. The visitor hash uses a salt that is created daily
      and deleted after two days, so it can't be linked across days or reversed.
- [x] Browsers sending Global Privacy Control or Do Not Track are not tracked.
- [x] Bots (by user agent) and signed-in admins are excluded.
- [x] Events older than 13 months, and analytics salts older than 2 days, are deleted by the
      housekeeping job (runs alongside traffic at most every 6 hours; optional daily cron).
- [x] Cloudflare's own Web Analytics script is kept off the page (`Cache-Control: no-transform`
      on HTML), so no third-party script runs on manuchie.org.

## Headers and transport

- [x] HTTPS only (Cloudflare), HSTS `max-age=31536000; includeSubDomains`.
- [x] Public site: CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
      frame protection (see `_headers`).
- [x] `robots.txt` disallows `/admin` and `/api/`.

## Still for the owner

- [ ] Resend account, domain verification and the three secrets (docs/DEPLOYMENT.md §2).
- [ ] Create the first admin with a strong password (docs/DEPLOYMENT.md §4).
- [ ] Publish a short privacy notice if Manuchie wants one linked from the form (the
      site's wording is content-locked, so none was added).
