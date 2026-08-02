'use strict';

/**
 * Data access layer for checklists. `items` is persisted as a JSON string;
 * callers work with the parsed array via getChecklistById.
 */

function insertChecklist(db, checklist) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO checklists
      (checklist_name, device_type, items, cycle_days, version, enabled, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    checklist.checklist_name,
    checklist.device_type,
    JSON.stringify(checklist.items),
    checklist.cycle_days,
    checklist.version,
    checklist.enabled ? 1 : 0,
    now,
    now,
  );
  return getChecklistById(db, Number(info.lastInsertRowid));
}

function getChecklistById(db, id) {
  const row = db.prepare('SELECT * FROM checklists WHERE id = ?').get(id);
  return hydrate(row);
}

function getMaxVersion(db, checklistName) {
  const row = db
    .prepare('SELECT MAX(version) AS max_version FROM checklists WHERE checklist_name = ?')
    .get(checklistName);
  return row && row.max_version ? row.max_version : 0;
}

function setChecklistEnabled(db, id, enabled) {
  const now = new Date().toISOString();
  db.prepare('UPDATE checklists SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now, id);
  return getChecklistById(db, id);
}

function listChecklists(db) {
  return db.prepare('SELECT * FROM checklists ORDER BY id').all().map(hydrate);
}

function hydrate(row) {
  if (!row) {
    return row;
  }
  return { ...row, items: JSON.parse(row.items) };
}

module.exports = {
  insertChecklist,
  getChecklistById,
  getMaxVersion,
  setChecklistEnabled,
  listChecklists,
};
