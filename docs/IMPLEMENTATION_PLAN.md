# Manuchie — rebuild implementation plan

Status: built, tested and live on manuchie.org since 29 Oct 2026 (see docs/TEST_REPORT.md). Backup of the pre-rebuild state: git tag
`backup/pre-rebuild-2026-10-29`.

## 1. Present structure (audit)

- Single static page `index.html` (hero · collaborator marquee · story · mantra · sound
  with Spotify, featured project, records and platforms · studio services and worldwide ·
  gallery · contact · footer), `styles.css`, `fonts.css` (self-hosted Newsreader + Inter),
  `script.js`, `config.js` (git-ignored booking email), `_headers`, `build.sh` → `dist/`.
- Contact form: `mailto:` — opens the visitor's email app. No backend, no database, no
  analytics, no admin.
- Hosting: Cloudflare, **Manuchie01@gmail.com's Account** (`c47856fcc04d89b572273dafaae646f1`),
  static-assets Worker `manuchie` on `manuchie.org` and `www.manuchie.org` (domain
  registered with Cloudflare Registrar in the same account). The old copy at
  `manuchie.pages.dev` lives in a different account and is no longer the live site.

## 2. Target architecture

One Cloudflare Worker (same name, same domains) with static assets plus a small API:

```
Browser ──► manuchie.org ──► Worker "manuchie"
                              ├─ static assets (dist/)            public site
                              ├─ /api/enquiry   POST              enquiry form
                              ├─ /api/collect   POST              first-party analytics beacon
                              ├─ /admin/*       auth-gated        private dashboard (static shell)
                              └─ /api/admin/*   auth-gated JSON   dashboard data + actions
                                     │
                                     ├─ D1 database "manuchie"    enquiries, contacts, consent,
                                     │                            events, admins, sessions
                                     └─ Resend HTTPS API          enquiry email + optional
                                                                  visitor acknowledgement
```

- No framework and no runtime dependencies (matches the site). Worker code is plain ES
  modules in `worker/`; dashboard is vanilla HTML/CSS/JS in `admin/`, copied to
  `dist/admin/` by `build.sh` and only served after the Worker checks the session.
- `assets.run_worker_first` = `/api/*`, `/admin`, `/admin/*`, so those never bypass the
  Worker. Everything else is served straight from the asset store.
- D1 migrations in `migrations/`. Housekeeping (expired sessions, rate-limit rows, analytics salts
  older than 2 days, events older than 13 months) runs alongside API traffic at most every 6 hours;
  a daily cron can be added once the account has a workers.dev subdomain.

## 3. Contracts between the public site and the Worker

### POST /api/enquiry

JavaScript path — `fetch("/api/enquiry", { method: "POST", headers: { "Content-Type":
"application/json" }, body })` with:

| field | type | notes |
|---|---|---|
| `name` | string | required, ≤ 120 |
| `email` | string | required, ≤ 254 |
| `message` | string | required, ≤ 5000 |
| `marketing_consent` | boolean | the separate, unticked checkbox |
| `botcheck` | boolean | honeypot checkbox (must be false) |
| `started_at` | number | `Date.now()` when the visitor first interacted with the form |
| `source_page` | string | `location.pathname` |
| `referrer` | string | `document.referrer` of the landing page (kept for the session) |
| `utm_source` / `utm_medium` / `utm_campaign` | string | from the landing URL, kept in `sessionStorage` |
| `sid` | string | analytics session id (see below) |

Responses: `200 {ok:true,id}` · `400 {ok:false,error:"validation",fields:{name?,email?,message?}}`
· `429 {ok:false,error:"rate_limited",retry_after}` · `403 {ok:false,error:"origin"}`
· `5xx {ok:false,error:"server"}`.

No-JavaScript path — `<form action="/api/enquiry" method="post">` (urlencoded, same field
names, checkbox values `"on"`). The Worker answers with a small HTML confirmation page.

### POST /api/collect

`navigator.sendBeacon("/api/collect", JSON.stringify(payload))` (falls back to
`fetch(..., {keepalive:true})`). Returns `204`. Payload:

```json
{ "type": "pageview|section_view|click|form_start", "name": "…", "path": "/",
  "ref": "https://…", "utm_source": "…", "utm_medium": "…", "utm_campaign": "…",
  "sid": "random-per-tab-id", "w": 1440 }
```

- `section_view` names: `hero`, `story`, `mantra`, `sound`, `studio`, `gallery`, `contact`
  (once per page load each).
- `click` names: `spotify`, `apple_music`, `youtube`, `shazam`, `instagram`, `email`,
  `book_session` (every "Book a session" / "Enquire about your next project" CTA).
- `form_start`: once per page load, on the first focus or input inside the form. No typed
  content is ever sent.
- `sid`: random id in `sessionStorage` (per tab, first-party, no cookie).
- The client sends nothing when `navigator.globalPrivacyControl === true` or
  `navigator.doNotTrack === "1"`.
- Successful enquiries are counted by the Worker itself, not by the client.
- Admin traffic: the Worker drops `/api/collect` requests that carry a valid admin
  session cookie; the dashboard never loads `script.js`.

## 4. Data model (D1)

`contacts` (one row per normalised email) · `enquiries` (status: new, read, replied,
in_progress, booked, closed, spam; notes; UTM; referrer; source page; email delivery
status) · `consent_records` (append-only proof: granted / withdrawn, exact wording,
timestamp, source page, salted IP hash) · `events` (anonymous analytics; daily-rotating
salted visitor hash, never a raw IP) · `admins` · `sessions` · `rate_limits`.
See `migrations/0001_init.sql`.

## 5. Security

PBKDF2-SHA256 password hashing (Web Crypto), `__Host-` session cookie (HttpOnly, Secure,
SameSite=Strict, 12 h absolute expiry), session tokens stored only as SHA-256 hashes,
Origin checks plus a per-session CSRF header on every state-changing admin call, login and
enquiry rate limiting, no public registration, first admin created with
`scripts/create-admin.mjs` (password typed locally, never stored in the repo), secrets only
in Worker secrets / `.dev.vars` (git-ignored), `Cache-Control: no-store` and
`X-Robots-Tag: noindex` on admin and API responses, strict CSP everywhere.

## 6. Environment variables

| name | kind | purpose |
|---|---|---|
| `MAIL_TO` | secret | Manuchie's inbox that receives enquiries |
| `MAIL_FROM` | secret | verified sender, e.g. `Manuchie Website <enquiries@manuchie.org>` |
| `RESEND_API_KEY` | secret | Resend API key |
| `SEND_ACKNOWLEDGEMENT` | var | `"true"` to email the visitor a short confirmation |
| `ANALYTICS_SALT` | secret | random string for the daily visitor hash |
| `SESSION_PEPPER` | secret | random string mixed into session-token and IP hashes |

Template: `.dev.vars.example`.

## 7. Work sequence

1. Audit (this file) · 2. Architecture (this file) · 3. Logo proposals (`brand/`, not
wired into the live site until approved) · 4. Public-site visual refinement · 5. Form
backend · 6. Database · 7. Authentication · 8. Dashboard · 9. Analytics · 10. Performance
and security · 11. Cross-device testing (390 / 768 / 1024 / 1440) · 12. Deployment docs.
