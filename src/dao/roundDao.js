'use strict';

/**
 * Data access layer for rounds, per-item results and exception reviews.
 * `checklist_snapshot` is stored as JSON and hydrated back into an object.
 */

function insertRound(db, round) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO rounds
      (device_id, checklist_id, planned_start_at, planned_end_at, round_status,
       owner_name, checklist_snapshot, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)
  `);
  const info = stmt.run(
    round.device_id,
    round.checklist_id,
    round.planned_start_at,
    round.planned_end_at,
    round.owner_name,
    JSON.stringify(round.checklist_snapshot),
    now,
    now,
  );
  return getRoundById(db, Number(info.lastInsertRowid));
}

function getRoundById(db, id) {
  return hydrateRound(db.prepare('SELECT * FROM rounds WHERE id = ?').get(id));
}

function updateRoundStatus(db, id, status, timestampColumn) {
  const now = new Date().toISOString();
  const cols = ['round_status = ?', 'updated_at = ?'];
  const params = [status, now];
  if (timestampColumn) {
    cols.push(`${timestampColumn} = ?`);
    params.push(now);
  }
  params.push(id);
  db.prepare(`UPDATE rounds SET ${cols.join(', ')} WHERE id = ?`).run(...params);
  return getRoundById(db, id);
}

function listRoundsByDevice(db, deviceId, limit) {
  const rows = db
    .prepare('SELECT * FROM rounds WHERE device_id = ? ORDER BY planned_start_at DESC, id DESC LIMIT ?')
    .all(deviceId, limit);
  return rows.map(hydrateRound);
}

function listOpenRoundsByArea(db, area) {
  return db
    .prepare(`
      SELECT r.*, d.area AS device_area, d.device_code, d.risk_level
      FROM rounds r
      JOIN devices d ON d.id = r.device_id
      WHERE d.area = ? AND r.round_status != 'closed'
      ORDER BY r.planned_start_at
    `)
    .all(area)
    .map(hydrateRound);
}

function insertResults(db, roundId, results) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO round_results (round_id, item_key, result, remark, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const inserted = [];
  for (const r of results) {
    const info = stmt.run(roundId, r.item_key, r.result, r.remark ?? null, now);
    inserted.push({ id: Number(info.lastInsertRowid), ...r });
  }
  return inserted;
}

function listResultsByRound(db, roundId) {
  return db.prepare('SELECT * FROM round_results WHERE round_id = ? ORDER BY id').all(roundId);
}

function insertExceptionReview(db, review) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO exception_reviews (round_id, result_id, item_key, severity, review_status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `);
  const info = stmt.run(review.round_id, review.result_id, review.item_key, review.severity, now);
  return getExceptionReviewById(db, Number(info.lastInsertRowid));
}

function getExceptionReviewById(db, id) {
  return db.prepare('SELECT * FROM exception_reviews WHERE id = ?').get(id);
}

function updateExceptionReview(db, id, reviewStatus, reviewerName, comment) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE exception_reviews
    SET review_status = ?, reviewer_name = ?, review_comment = ?, reviewed_at = ?
    WHERE id = ?
  `).run(reviewStatus, reviewerName ?? null, comment ?? null, now, id);
  return getExceptionReviewById(db, id);
}

function listReviewsByRound(db, roundId) {
  return db.prepare('SELECT * FROM exception_reviews WHERE round_id = ? ORDER BY id').all(roundId);
}

function countPendingReviews(db, roundId) {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS pending
      FROM exception_reviews
      WHERE round_id = ? AND review_status IN ('pending', 'confirmed')
    `)
    .get(roundId);
  return row.pending;
}

/**
 * List exception reviews joined with device + result data, filtered by risk level.
 * Used by the "abnormal items by risk level" query.
 */
function listExceptionsByRiskLevel(db, riskLevel) {
  return db
    .prepare(`
      SELECT er.*, d.device_code, d.device_name, d.area, d.risk_level, rr.result, rr.remark
      FROM exception_reviews er
      JOIN rounds r        ON r.id = er.round_id
      JOIN devices d       ON d.id = r.device_id
      JOIN round_results rr ON rr.id = er.result_id
      WHERE d.risk_level = ?
      ORDER BY er.created_at DESC, er.id DESC
    `)
    .all(riskLevel);
}

/**
 * Aggregated exception counts grouped by area (and severity), for the
 * area-exception statistics endpoint.
 */
function areaExceptionStats(db) {
  return db
    .prepare(`
      SELECT d.area AS area,
             er.severity AS severity,
             er.review_status AS review_status,
             COUNT(*) AS total
      FROM exception_reviews er
      JOIN rounds r  ON r.id = er.round_id
      JOIN devices d ON d.id = r.device_id
      GROUP BY d.area, er.severity, er.review_status
    `)
    .all();
}

function hydrateRound(row) {
  if (!row) {
    return row;
  }
  return { ...row, checklist_snapshot: JSON.parse(row.checklist_snapshot) };
}

/**
 * Per-round rows scoped to a device group, exposing exactly the fields needed
 * to build the area/risk-level risk summary in the service layer:
 *   - round_status              (reuse existing lifecycle state)
 *   - planned_end_at            (for dynamic overdue calculation)
 *   - exception_items           number of round_results with attention/fault
 *   - pending_exceptions        number of exception_reviews not yet cleared
 *
 * No new status columns are introduced; everything is derived from the
 * existing rounds / round_results / exception_reviews tables.
 */
function riskSummaryRows(db) {
  return db
    .prepare(`
      SELECT d.area                     AS area,
             d.risk_level               AS risk_level,
             r.id                       AS round_id,
             r.round_status             AS round_status,
             r.planned_end_at           AS planned_end_at,
             (SELECT COUNT(*) FROM round_results rr
                WHERE rr.round_id = r.id AND rr.result IN ('attention', 'fault')
             )                          AS exception_items,
             (SELECT COUNT(*) FROM exception_reviews er
                WHERE er.round_id = r.id AND er.review_status IN ('pending', 'confirmed')
             )                          AS pending_exceptions
      FROM rounds r
      JOIN devices d ON d.id = r.device_id
      ORDER BY d.area, d.risk_level, r.id
    `)
    .all();
}

module.exports = {
  insertRound,
  getRoundById,
  updateRoundStatus,
  listRoundsByDevice,
  listOpenRoundsByArea,
  insertResults,
  listResultsByRound,
  insertExceptionReview,
  getExceptionReviewById,
  updateExceptionReview,
  listReviewsByRound,
  countPendingReviews,
  listExceptionsByRiskLevel,
  areaExceptionStats,
  riskSummaryRows,
};
