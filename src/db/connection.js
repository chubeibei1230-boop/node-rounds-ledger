const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { dbFile } = require('../config');
const { SCHEMA_SQL } = require('./schema');

let db = null;

function getDb() {
  if (db) return db;
  if (dbFile !== ':memory:') {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  }
  db = new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}

// 兼容旧库：checklists 补充 enabled 列、rounds 补充 checklist_snapshot 列（新库已由 SCHEMA_SQL 创建）
function migrate(database) {
  const checklistColumns = database.prepare('PRAGMA table_info(checklists)').all();
  if (!checklistColumns.some((c) => c.name === 'enabled')) {
    database.exec('ALTER TABLE checklists ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
  }

  const roundColumns = database.prepare('PRAGMA table_info(rounds)').all();
  if (!roundColumns.some((c) => c.name === 'checklist_snapshot')) {
    database.exec('ALTER TABLE rounds ADD COLUMN checklist_snapshot TEXT');
    // 旧轮次按当前清单内容回填快照
    const rows = database
      .prepare(
        `SELECT r.id AS round_id, c.id AS checklist_id, c.checklist_name, c.version, c.device_type, c.items
         FROM rounds r JOIN checklists c ON c.id = r.checklist_id`
      )
      .all();
    const update = database.prepare('UPDATE rounds SET checklist_snapshot = ? WHERE id = ?');
    for (const row of rows) {
      update.run(
        JSON.stringify({
          checklist_id: row.checklist_id,
          checklist_name: row.checklist_name,
          version: row.version,
          device_type: row.device_type,
          items: JSON.parse(row.items),
        }),
        row.round_id
      );
    }
  }

  // review_status CHECK 约束不含 ignored 时重建 exception_reviews 表
  const tableSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'exception_reviews'")
    .get();
  if (tableSql && !tableSql.sql.includes("'ignored'")) {
    database.exec(`
      BEGIN;
      CREATE TABLE exception_reviews_new (
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
      INSERT INTO exception_reviews_new SELECT * FROM exception_reviews;
      DROP TABLE exception_reviews;
      ALTER TABLE exception_reviews_new RENAME TO exception_reviews;
      CREATE INDEX IF NOT EXISTS idx_exception_reviews_round ON exception_reviews (round_id);
      CREATE INDEX IF NOT EXISTS idx_exception_reviews_status ON exception_reviews (review_status);
      COMMIT;
    `);
  }
}

module.exports = { getDb };
