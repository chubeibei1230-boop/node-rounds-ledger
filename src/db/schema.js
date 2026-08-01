const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_code TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  area TEXT NOT NULL,
  device_type TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  enabled INTEGER NOT NULL DEFAULT 1,
  maintenance_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  items TEXT NOT NULL,
  cycle_days INTEGER NOT NULL CHECK (cycle_days > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (checklist_name, version)
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices (id),
  checklist_id INTEGER NOT NULL REFERENCES checklists (id),
  checklist_snapshot TEXT NOT NULL,
  planned_start_at TEXT NOT NULL,
  planned_end_at TEXT NOT NULL,
  round_status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (round_status IN ('scheduled', 'in_progress', 'submitted', 'closed')),
  owner_name TEXT NOT NULL,
  started_at TEXT,
  submitted_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rounds_device ON rounds (device_id);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds (round_status);

CREATE TABLE IF NOT EXISTS round_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds (id),
  item_key TEXT NOT NULL,
  item_name TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('normal', 'attention', 'fault', 'skipped')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (round_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_round_results_round ON round_results (round_id);

CREATE TABLE IF NOT EXISTS exception_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds (id),
  result_id INTEGER NOT NULL REFERENCES round_results (id),
  device_id INTEGER NOT NULL REFERENCES devices (id),
  exception_type TEXT NOT NULL CHECK (exception_type IN ('attention', 'fault')),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'confirmed', 'ignored', 'resolved')),
  reviewer_name TEXT,
  review_comment TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exception_reviews_round ON exception_reviews (round_id);
CREATE INDEX IF NOT EXISTS idx_exception_reviews_status ON exception_reviews (review_status);
`;

module.exports = { SCHEMA_SQL };
