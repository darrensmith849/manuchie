-- Manuchie website database (Cloudflare D1 / SQLite)
-- Times are ISO-8601 UTC strings ("2026-10-29T09:41:00.000Z"); days are "YYYY-MM-DD" (UTC).

-- People who have sent an enquiry. One row per normalised email address.
CREATE TABLE contacts (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  email_norm        TEXT NOT NULL UNIQUE,                 -- lower(trim(email)): prevents duplicates
  name              TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  source            TEXT,                                 -- first source: utm_source, referrer host or "direct"
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suppressed')),  -- suppressed = never market to
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0, 1)),
  consent_at        TEXT,                                 -- when current consent was granted
  unsubscribed_at   TEXT,
  tags              TEXT NOT NULL DEFAULT '[]',           -- JSON array of strings
  notes             TEXT NOT NULL DEFAULT '',
  last_contacted_at TEXT
);

-- Every enquiry sent through the website form (transactional, not marketing).
CREATE TABLE enquiries (
  id                TEXT PRIMARY KEY,
  contact_id        TEXT REFERENCES contacts(id) ON DELETE CASCADE,  -- NULL for spam
  name              TEXT NOT NULL,
  email             TEXT NOT NULL,
  message           TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  source_page       TEXT,
  referrer          TEXT,                                 -- landing referrer, without query string
  utm_source        TEXT,
  utm_medium        TEXT,
  utm_campaign      TEXT,
  status            TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'read', 'replied', 'in_progress', 'booked', 'closed', 'spam')),
  spam_reason       TEXT,
  notes             TEXT NOT NULL DEFAULT '',
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0, 1)),
  last_contacted_at TEXT,
  email_status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (email_status IN ('pending', 'sent', 'failed', 'not_configured', 'skipped')),
  ack_status        TEXT NOT NULL DEFAULT 'skipped'
                    CHECK (ack_status IN ('pending', 'sent', 'failed', 'not_configured', 'skipped'))
);
CREATE INDEX enquiries_created ON enquiries (created_at);
CREATE INDEX enquiries_status ON enquiries (status, created_at);
CREATE INDEX enquiries_contact ON enquiries (contact_id);

-- Append-only proof of marketing consent (granted) and its withdrawal.
CREATE TABLE consent_records (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  enquiry_id  TEXT REFERENCES enquiries(id) ON DELETE SET NULL,
  action      TEXT NOT NULL CHECK (action IN ('granted', 'withdrawn')),
  wording     TEXT NOT NULL,                              -- exact text the person agreed to, or the reason
  method      TEXT NOT NULL,                              -- "website form", "dashboard"
  source_page TEXT,
  created_at  TEXT NOT NULL,
  ip_hash     TEXT,                                       -- salted hash, never the raw IP
  user_agent  TEXT
);
CREATE INDEX consent_contact ON consent_records (contact_id, created_at);

-- Anonymous first-party analytics. No IPs, no cookies, no form content.
CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  day          TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('pageview', 'section_view', 'click', 'form_start', 'enquiry')),
  name         TEXT,                                      -- section id or click target
  path         TEXT,
  visitor      TEXT NOT NULL,                             -- hash with a salt that is deleted after 2 days
  session      TEXT,                                      -- random per-tab id from sessionStorage
  ref_host     TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  device       TEXT CHECK (device IN ('mobile', 'tablet', 'desktop')),
  country      TEXT                                       -- 2-letter country code from Cloudflare
);
CREATE INDEX events_day_type ON events (day, type);
CREATE INDEX events_type_day_name ON events (type, day, name);

-- Dashboard administrators. Created only with scripts/create-admin.mjs (no registration page).
CREATE TABLE admins (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                            -- pbkdf2_sha256$iterations$salt$hash
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_login_at TEXT
);

-- Signed-in dashboard sessions. Only a SHA-256 hash of the cookie token is stored.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  admin_id     TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT
);
CREATE INDEX sessions_admin ON sessions (admin_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- Sliding-window rate limiting (enquiries, logins). Purged daily.
CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  ts     INTEGER NOT NULL                                 -- unix milliseconds
);
CREATE INDEX rate_limits_bucket ON rate_limits (bucket, ts);

-- Server-generated secrets (session pepper, daily analytics salts). Never sent to a browser.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
