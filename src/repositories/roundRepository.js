function insertRound(db, round) {
  const stmt = db.prepare(`
    INSERT INTO rounds (device_id, checklist_id, checklist_snapshot, planned_start_at, planned_end_at, round_status, owner_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    round.device_id,
    round.checklist_id,
    round.checklist_snapshot,
    round.planned_start_at,
    round.planned_end_at,
    round.round_status,
    round.owner_name,
    round.created_at,
    round.updated_at
  );
  return Number(info.lastInsertRowid);
}

function findRoundById(db, id) {
  return db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
}

function updateRoundStatus(db, id, status, timestamps, updatedAt) {
  const sets = ['round_status = ?', 'updated_at = ?'];
  const params = [status, updatedAt];
  for (const [column, value] of Object.entries(timestamps)) {
    sets.push(`${column} = ?`);
    params.push(value);
  }
  params.push(id);
  db.prepare(`UPDATE rounds SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function findLatestRoundByDevice(db, deviceId) {
  return db
    .prepare(
      'SELECT * FROM rounds WHERE device_id = ? ORDER BY planned_start_at DESC, id DESC LIMIT 1'
    )
    .get(deviceId);
}

function findOpenRoundsByArea(db, area) {
  return db
    .prepare(
      `SELECT r.*, d.device_code, d.device_name, d.area, d.device_type, d.risk_level,
              (SELECT COUNT(*) FROM exception_reviews e
               WHERE e.round_id = r.id AND e.review_status = 'pending') AS pending_exceptions
       FROM rounds r
       JOIN devices d ON d.id = r.device_id
       WHERE d.area = ? AND r.round_status != 'closed'
       ORDER BY r.planned_start_at ASC, r.id ASC`
    )
    .all(area);
}

module.exports = {
  insertRound,
  findRoundById,
  updateRoundStatus,
  findLatestRoundByDevice,
  findOpenRoundsByArea,
};
