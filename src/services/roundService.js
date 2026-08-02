'use strict';

const roundDao = require('../dao/roundDao');
const deviceDao = require('../dao/deviceDao');
const checklistDao = require('../dao/checklistDao');
const {
  requirePositiveInt,
  requireString,
  requireIsoDate,
  requireEnum,
  optionalString,
} = require('../validation');
const { notFound, conflict, badRequest } = require('../errors');
const { assertTransition } = require('../stateMachine');

const RESULT_VALUES = ['normal', 'attention', 'fault', 'skipped'];
const EXCEPTION_SEVERITIES = ['attention', 'fault'];
const REVIEW_CONCLUSIONS = ['confirmed', 'ignored', 'resolved'];

/**
 * Generate a round for a device + checklist. Validates that the device exists
 * and is enabled, the checklist exists and is enabled, and their device_type
 * matches. A frozen checklist snapshot is stored on the round so later checklist
 * edits never affect historical rounds.
 */
function generateRound(db, body) {
  const deviceId = requirePositiveInt(body.device_id, 'device_id');
  const checklistId = requirePositiveInt(body.checklist_id, 'checklist_id');
  const plannedStart = requireIsoDate(body.planned_start_at, 'planned_start_at');
  const plannedEnd = requireIsoDate(body.planned_end_at, 'planned_end_at');
  const ownerName = requireString(body.owner_name, 'owner_name');

  if (Date.parse(plannedEnd) < Date.parse(plannedStart)) {
    throw badRequest('planned_end_at cannot be earlier than planned_start_at', {
      planned_start_at: plannedStart,
      planned_end_at: plannedEnd,
    });
  }

  const device = deviceDao.getDeviceById(db, deviceId);
  if (!device) {
    throw notFound(`Device ${deviceId} not found`, { device_id: deviceId });
  }
  if (!device.enabled) {
    throw conflict(`Device ${deviceId} is disabled`, { device_id: deviceId });
  }

  const checklist = checklistDao.getChecklistById(db, checklistId);
  if (!checklist) {
    throw notFound(`Checklist ${checklistId} not found`, { checklist_id: checklistId });
  }
  if (!checklist.enabled) {
    throw conflict(`Checklist ${checklistId} is disabled`, { checklist_id: checklistId });
  }
  if (checklist.device_type !== device.device_type) {
    throw conflict('Checklist device_type does not match device device_type', {
      device_type: device.device_type,
      checklist_device_type: checklist.device_type,
    });
  }

  const snapshot = {
    checklist_id: checklist.id,
    checklist_name: checklist.checklist_name,
    version: checklist.version,
    device_type: checklist.device_type,
    items: checklist.items,
  };

  return roundDao.insertRound(db, {
    device_id: deviceId,
    checklist_id: checklistId,
    planned_start_at: plannedStart,
    planned_end_at: plannedEnd,
    owner_name: ownerName,
    checklist_snapshot: snapshot,
  });
}

function getRound(db, id) {
  const round = roundDao.getRoundById(db, id);
  if (!round) {
    throw notFound(`Round ${id} not found`, { round_id: id });
  }
  return round;
}

/** scheduled -> in_progress */
function startRound(db, id) {
  const round = getRound(db, id);
  assertTransition(round.round_status, 'in_progress');
  return roundDao.updateRoundStatus(db, id, 'in_progress', 'started_at');
}

/**
 * Submit results for a round (in_progress -> submitted).
 * Results must cover every item in the round's own snapshot, matched by
 * item_key and count. attention/fault results auto-generate pending exception
 * reviews that must be resolved before the round can be closed.
 */
function submitResults(db, id, body) {
  const round = getRound(db, id);
  assertTransition(round.round_status, 'submitted');

  if (!Array.isArray(body.results)) {
    throw badRequest("Field 'results' must be an array", { field: 'results' });
  }

  const snapshotItems = round.checklist_snapshot.items;
  if (body.results.length !== snapshotItems.length) {
    throw badRequest(
      `Results count (${body.results.length}) must equal checklist item count (${snapshotItems.length})`,
      { expected: snapshotItems.length, received: body.results.length },
    );
  }

  // Validate each result and match against the snapshot by position + item_key.
  const validated = body.results.map((raw, index) => {
    const itemKey = requireString(raw.item_key, `results[${index}].item_key`);
    const result = requireEnum(raw.result, `results[${index}].result`, RESULT_VALUES);
    const remark = optionalString(raw.remark, `results[${index}].remark`);
    const expectedKey = snapshotItems[index].item_key;
    if (itemKey !== expectedKey) {
      throw badRequest(
        `results[${index}].item_key '${itemKey}' does not match checklist item '${expectedKey}'`,
        { index, expected_item_key: expectedKey, received_item_key: itemKey },
      );
    }
    return { item_key: itemKey, result, remark };
  });

  db.exec('BEGIN');
  try {
    const inserted = roundDao.insertResults(db, id, validated);
    for (const row of inserted) {
      if (EXCEPTION_SEVERITIES.includes(row.result)) {
        roundDao.insertExceptionReview(db, {
          round_id: id,
          result_id: row.id,
          item_key: row.item_key,
          severity: row.result,
        });
      }
    }
    const updated = roundDao.updateRoundStatus(db, id, 'submitted', 'submitted_at');
    db.exec('COMMIT');
    return { round: updated, results: roundDao.listResultsByRound(db, id) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Record a review conclusion for an exception (confirmed/ignored/resolved).
 * `confirmed` still counts as pending for closure purposes (confirmed problem
 * awaiting fix); only `ignored`/`resolved` clear the exception.
 */
function reviewException(db, roundId, reviewId, body) {
  const round = getRound(db, roundId);
  const review = roundDao.getExceptionReviewById(db, reviewId);
  if (!review || review.round_id !== round.id) {
    throw notFound(`Exception review ${reviewId} not found for round ${roundId}`, {
      round_id: roundId,
      review_id: reviewId,
    });
  }
  const conclusion = requireEnum(body.review_status, 'review_status', REVIEW_CONCLUSIONS);
  const reviewerName = requireString(body.reviewer_name, 'reviewer_name');
  const comment = optionalString(body.review_comment, 'review_comment');
  return roundDao.updateExceptionReview(db, reviewId, conclusion, reviewerName, comment);
}

/**
 * Close a round (submitted -> closed). Blocked while any exception review is
 * still pending or merely confirmed (not yet ignored/resolved).
 */
function closeRound(db, id) {
  const round = getRound(db, id);
  assertTransition(round.round_status, 'closed');

  const pending = roundDao.countPendingReviews(db, id);
  if (pending > 0) {
    throw conflict('Round has unresolved exception reviews and cannot be closed', {
      round_id: id,
      pending_exceptions: pending,
    });
  }
  return roundDao.updateRoundStatus(db, id, 'closed', 'closed_at');
}

// ---- Query endpoints -------------------------------------------------------

function recentRoundsForDevice(db, deviceId, limit = 10) {
  const device = deviceDao.getDeviceById(db, deviceId);
  if (!device) {
    throw notFound(`Device ${deviceId} not found`, { device_id: deviceId });
  }
  const rounds = roundDao.listRoundsByDevice(db, deviceId, limit);
  return { device, rounds };
}

function openRoundsByArea(db, area) {
  requireString(area, 'area');
  const rounds = roundDao.listOpenRoundsByArea(db, area);
  const now = Date.now();
  return rounds.map((r) => ({
    ...r,
    pending_exceptions: roundDao.countPendingReviews(db, r.id),
    overdue: Date.parse(r.planned_end_at) < now && r.round_status !== 'closed',
  }));
}

function exceptionsByRiskLevel(db, riskLevel) {
  requireEnum(riskLevel, 'risk_level', ['low', 'medium', 'high']);
  return roundDao.listExceptionsByRiskLevel(db, riskLevel);
}

/**
 * Aggregate exception counts per area. Returns one entry per area with totals
 * broken down by severity and unresolved counts.
 */
function areaExceptionStatistics(db) {
  const rows = roundDao.areaExceptionStats(db);
  const byArea = new Map();
  for (const row of rows) {
    if (!byArea.has(row.area)) {
      byArea.set(row.area, {
        area: row.area,
        total: 0,
        attention: 0,
        fault: 0,
        unresolved: 0,
      });
    }
    const entry = byArea.get(row.area);
    entry.total += row.total;
    entry[row.severity] += row.total;
    if (row.review_status === 'pending' || row.review_status === 'confirmed') {
      entry.unresolved += row.total;
    }
  }
  return Array.from(byArea.values()).sort((a, b) => a.area.localeCompare(b.area));
}

/**
 * Risk summary grouped by (area, risk_level), for operations managers to see
 * inspection pressure and risk distribution. All figures are derived from the
 * existing round lifecycle + exception-review data — no new status field.
 *
 * Per group it reports:
 *   - open_rounds          rounds whose round_status != 'closed'
 *   - closed_rounds        rounds whose round_status == 'closed'
 *   - exception_items      count of attention/fault result items
 *   - pending_exceptions   count of exception reviews still pending/confirmed
 *   - overdue_rounds       open rounds whose planned_end_at is already past now
 *   - overdue              true when overdue_rounds > 0 (computed, never persisted)
 *
 * Optional filters: area and/or risk_level.
 */
function riskSummary(db, { area, riskLevel } = {}) {
  if (area !== undefined && area !== null) {
    requireString(area, 'area');
  }
  if (riskLevel !== undefined && riskLevel !== null) {
    requireEnum(riskLevel, 'risk_level', ['low', 'medium', 'high']);
  }

  const now = Date.now();
  const groups = new Map();

  for (const row of roundDao.riskSummaryRows(db)) {
    if (area && row.area !== area) {
      continue;
    }
    if (riskLevel && row.risk_level !== riskLevel) {
      continue;
    }

    const key = `${row.area}\u0000${row.risk_level}`;
    if (!groups.has(key)) {
      groups.set(key, {
        area: row.area,
        risk_level: row.risk_level,
        open_rounds: 0,
        closed_rounds: 0,
        exception_items: 0,
        pending_exceptions: 0,
        overdue_rounds: 0,
        overdue: false,
      });
    }
    const g = groups.get(key);
    const isClosed = row.round_status === 'closed';

    if (isClosed) {
      g.closed_rounds += 1;
    } else {
      g.open_rounds += 1;
      if (Date.parse(row.planned_end_at) < now) {
        g.overdue_rounds += 1;
        g.overdue = true;
      }
    }
    g.exception_items += row.exception_items;
    g.pending_exceptions += row.pending_exceptions;
  }

  return Array.from(groups.values()).sort(
    (a, b) => a.area.localeCompare(b.area) || a.risk_level.localeCompare(b.risk_level),
  );
}

module.exports = {
  generateRound,
  getRound,
  startRound,
  submitResults,
  reviewException,
  closeRound,
  recentRoundsForDevice,
  openRoundsByArea,
  exceptionsByRiskLevel,
  areaExceptionStatistics,
  riskSummary,
  RESULT_VALUES,
  REVIEW_CONCLUSIONS,
};
