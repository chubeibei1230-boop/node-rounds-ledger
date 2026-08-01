function insertException(db, exception) {
  const stmt = db.prepare(`
    INSERT INTO exception_reviews (round_id, result_id, device_id, exception_type, review_status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `);
  const info = stmt.run(
    exception.round_id,
    exception.result_id,
    exception.device_id,
    exception.exception_type,
    exception.created_at
  );
  return Number(info.lastInsertRowid);
}

function findExceptionById(db, id) {
  return db.prepare('SELECT * FROM exception_reviews WHERE id = ?').get(id);
}

function updateReview(db, id, review) {
  db.prepare(
    `UPDATE exception_reviews
     SET review_status = ?, reviewer_name = ?, review_comment = ?, reviewed_at = ?
     WHERE id = ?`
  ).run(review.review_status, review.reviewer_name, review.review_comment, review.reviewed_at, id);
}

function listExceptions(db, filters) {
  const where = [];
  const params = [];
  if (filters.risk_level) {
    where.push('d.risk_level = ?');
    params.push(filters.risk_level);
  }
  if (filters.review_status) {
    where.push('e.review_status = ?');
    params.push(filters.review_status);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT e.*, d.device_code, d.device_name, d.area, d.device_type, d.risk_level
       FROM exception_reviews e
       JOIN devices d ON d.id = e.device_id
       ${whereSql}
       ORDER BY e.created_at DESC, e.id DESC`
    )
    .all(...params);
}

function countUnresolvedByRound(db, roundId) {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS unresolved_count FROM exception_reviews WHERE round_id = ? AND review_status NOT IN ('ignored', 'resolved')"
    )
    .get(roundId);
  return Number(row.unresolved_count);
}

function areaExceptionStats(db) {
  return db
    .prepare(
      `SELECT d.area AS area,
              COUNT(*) AS total_exceptions,
              SUM(CASE WHEN e.exception_type = 'attention' THEN 1 ELSE 0 END) AS attention_count,
              SUM(CASE WHEN e.exception_type = 'fault' THEN 1 ELSE 0 END) AS fault_count,
              SUM(CASE WHEN e.review_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
              SUM(CASE WHEN e.review_status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_count,
              SUM(CASE WHEN e.review_status = 'ignored' THEN 1 ELSE 0 END) AS ignored_count,
              SUM(CASE WHEN e.review_status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count
       FROM exception_reviews e
       JOIN devices d ON d.id = e.device_id
       GROUP BY d.area
       ORDER BY d.area ASC`
    )
    .all();
}

module.exports = {
  insertException,
  findExceptionById,
  updateReview,
  listExceptions,
  countUnresolvedByRound,
  areaExceptionStats,
};
