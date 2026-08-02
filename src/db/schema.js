'use strict';

/**
 * Database schema for the inspection rounds ledger.
 *
 * Five tables:
 *   - devices            equipment ledger
 *   - checklists         versioned inspection checklists
 *   - rounds             planned/executed inspection rounds (carry a checklist snapshot)
 *   - round_results      per-item execution results for a round
 *   - exception_reviews  follow-up reviews for attention/fault results
 *
 * All timestamps are stored as ISO-8601 strings in UTC.
 */
function applySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code      TEXT NOT NULL UNIQUE,
      device_name      TEXT NOT NULL,
      area             TEXT NOT NULL,
      device_type      TEXT NOT NULL,
      risk_level       TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
      enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      maintenance_note TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checklists (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      checklist_name TEXT NOT NULL,
      device_type    TEXT NOT NULL,
      items          TEXT NOT NULL,           -- JSON array of { item_key, label }
      cycle_days     INTEGER NOT NULL CHECK (cycle_days > 0),
      version        INTEGER NOT NULL,
      enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      UNIQUE (checklist_name, version)
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id          INTEGER NOT NULL REFERENCES devices(id),
      checklist_id       INTEGER NOT NULL REFERENCES checklists(id),
      planned_start_at   TEXT NOT NULL,
      planned_end_at     TEXT NOT NULL,
      round_status       TEXT NOT NULL DEFAULT 'scheduled'
                           CHECK (round_status IN ('scheduled', 'in_progress', 'submitted', 'closed')),
      owner_name         TEXT NOT NULL,
      checklist_snapshot TEXT NOT NULL,        -- frozen copy of the checklist at generation time
      started_at         TEXT,
      submitted_at       TEXT,
      closed_at          TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS round_results (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id    INTEGER NOT NULL REFERENCES rounds(id),
      item_key    TEXT NOT NULL,
      result      TEXT NOT NULL CHECK (result IN ('normal', 'attention', 'fault', 'skipped')),
      remark      TEXT,
      created_at  TEXT NOT NULL,
      UNIQUE (round_id, item_key)
    );

    CREATE TABLE IF NOT EXISTS exception_reviews (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id        INTEGER NOT NULL REFERENCES rounds(id),
      result_id       INTEGER NOT NULL REFERENCES round_results(id),
      item_key        TEXT NOT NULL,
      severity        TEXT NOT NULL CHECK (severity IN ('attention', 'fault')),
      review_status   TEXT NOT NULL DEFAULT 'pending'
                        CHECK (review_status IN ('pending', 'confirmed', 'ignored', 'resolved')),
      reviewer_name   TEXT,
      review_comment  TEXT,
      created_at      TEXT NOT NULL,
      reviewed_at     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_rounds_device ON rounds(device_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(round_status);
    CREATE INDEX IF NOT EXISTS idx_results_round ON round_results(round_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_round ON exception_reviews(round_id);
  `);
}

module.exports = { applySchema };
