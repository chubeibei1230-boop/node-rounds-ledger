function insertChecklist(db, checklist) {
  const stmt = db.prepare(`
    INSERT INTO checklists (checklist_name, device_type, items, cycle_days, version, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    checklist.checklist_name,
    checklist.device_type,
    checklist.items,
    checklist.cycle_days,
    checklist.version,
    checklist.created_at
  );
  return Number(info.lastInsertRowid);
}

function findChecklistById(db, id) {
  return db.prepare('SELECT * FROM checklists WHERE id = ?').get(id);
}

function findChecklistByNameVersion(db, checklistName, version) {
  return db
    .prepare('SELECT * FROM checklists WHERE checklist_name = ? AND version = ?')
    .get(checklistName, version);
}

function maxVersionForName(db, checklistName) {
  const row = db
    .prepare('SELECT MAX(version) AS max_version FROM checklists WHERE checklist_name = ?')
    .get(checklistName);
  return row && row.max_version !== null ? Number(row.max_version) : 0;
}

function setChecklistEnabled(db, id, enabled) {
  db.prepare('UPDATE checklists SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

module.exports = {
  insertChecklist,
  findChecklistById,
  findChecklistByNameVersion,
  maxVersionForName,
  setChecklistEnabled,
};
