-- The studio desk: projects with to-do lists, money in and out, and fuller client records.
-- Amounts are whole cents in the studio currency (settings key "currency", default USD).

-- Clients: contacts can now be added by hand, with a phone number and a company.
-- A client added without an email gets email = '' and email_norm = 'none:<id>' (keeps it unique).
ALTER TABLE contacts ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN company TEXT NOT NULL DEFAULT '';

CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  contact_id   TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  enquiry_id   TEXT REFERENCES enquiries(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'production',
  status       TEXT NOT NULL DEFAULT 'booked'
               CHECK (status IN ('lead', 'booked', 'in_progress', 'review', 'completed', 'on_hold', 'cancelled')),
  progress     INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  start_date   TEXT,                                   -- YYYY-MM-DD
  due_date     TEXT,                                   -- YYYY-MM-DD
  completed_at TEXT,
  fee_cents    INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),   -- agreed fee for the project
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX projects_status ON projects (status, due_date);
CREATE INDEX projects_contact ON projects (contact_id);

CREATE TABLE project_tasks (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  done_at    TEXT
);
CREATE INDEX tasks_project ON project_tasks (project_id, position);

-- Money in (income) and out (expenses). settled = 1: received / paid; 0: still expected / still due.
CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = general studio income/expense
  kind         TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  date         TEXT NOT NULL,                                    -- YYYY-MM-DD (paid on, or expected on)
  settled      INTEGER NOT NULL DEFAULT 1 CHECK (settled IN (0, 1)),
  category     TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX transactions_kind_date ON transactions (kind, settled, date);
CREATE INDEX transactions_project ON transactions (project_id);
