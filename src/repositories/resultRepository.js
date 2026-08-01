function insertResult(db, result) {
  const stmt = db.prepare(`
    INSERT INTO round_results (round_id, item_key, item_name, result, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    result.round_id,
    result.item_key,
    result.item_name,
    result.result,
    result.note,
    result.created_at
  );
  return Number(info.lastInsertRowid);
}

function listResultsByRound(db, roundId) {
  return db
    .prepare('SELECT * FROM round_results WHERE round_id = ? ORDER BY id ASC')
    .all(roundId);
}

module.exports = { insertResult, listResultsByRound };
