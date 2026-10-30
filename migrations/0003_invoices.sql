-- Invoices, and project types as editable labels.

-- Project types are now free labels from the list Manuchie edits in Settings.
UPDATE projects SET type = CASE type
  WHEN 'production' THEN 'Production' WHEN 'songwriting' THEN 'Songwriting' WHEN 'vocal_production' THEN 'Vocal production'
  WHEN 'mixing_mastering' THEN 'Mixing & mastering' WHEN 'music_direction' THEN 'Music direction' WHEN 'keys' THEN 'Keys session'
  WHEN 'arrangement' THEN 'Arrangement' WHEN 'other' THEN 'Other' ELSE type END;

-- An invoice keeps its own copy of the client's details (an issued invoice must not change
-- when the client record is edited later). Items: JSON [{ "description", "qty", "unit_cents" }].
CREATE TABLE invoices (
  id              TEXT PRIMARY KEY,
  number          TEXT NOT NULL UNIQUE,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  contact_id      TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  issue_date      TEXT NOT NULL,                       -- YYYY-MM-DD
  due_date        TEXT,                                -- YYYY-MM-DD
  currency        TEXT NOT NULL,
  client_name     TEXT NOT NULL DEFAULT '',
  client_company  TEXT NOT NULL DEFAULT '',
  client_email    TEXT NOT NULL DEFAULT '',
  client_phone    TEXT NOT NULL DEFAULT '',
  client_address  TEXT NOT NULL DEFAULT '',
  items           TEXT NOT NULL DEFAULT '[]',
  discount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_bp          INTEGER NOT NULL DEFAULT 0 CHECK (tax_bp BETWEEN 0 AND 10000),   -- basis points: 1500 = 15%
  tax_label       TEXT NOT NULL DEFAULT 'Tax',
  notes           TEXT NOT NULL DEFAULT '',
  share_token     TEXT UNIQUE,                         -- private link for the client; NULL = not shared
  transaction_id  TEXT REFERENCES transactions(id) ON DELETE SET NULL,   -- the income logged when paid
  sent_at         TEXT,
  paid_at         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX invoices_status ON invoices (status, due_date);
CREATE INDEX invoices_project ON invoices (project_id);
CREATE INDEX invoices_contact ON invoices (contact_id);
