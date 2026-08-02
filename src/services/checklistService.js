'use strict';

const checklistDao = require('../dao/checklistDao');
const {
  requireString,
  requirePositiveInt,
  requireChecklistItems,
} = require('../validation');
const { notFound, conflict } = require('../errors');

function createChecklist(db, body) {
  const checklist = {
    checklist_name: requireString(body.checklist_name, 'checklist_name'),
    device_type: requireString(body.device_type, 'device_type'),
    items: requireChecklistItems(body.items),
    cycle_days: requirePositiveInt(body.cycle_days, 'cycle_days'),
    enabled: true,
  };

  // New checklist_name starts at version 1; reusing a name is rejected here —
  // callers should use copyChecklistVersion to add a version.
  const existingMax = checklistDao.getMaxVersion(db, checklist.checklist_name);
  if (existingMax > 0) {
    throw conflict(
      `Checklist '${checklist.checklist_name}' already exists; use the copy endpoint to add a version`,
      { checklist_name: checklist.checklist_name, current_max_version: existingMax },
    );
  }

  checklist.version = 1;
  return checklistDao.insertChecklist(db, checklist);
}

/**
 * Copy an existing checklist into a new version. The new version number is the
 * current max for that name + 1. Optionally overrides items/cycle_days.
 * The source version is disabled so only the latest stays active.
 */
function copyChecklistVersion(db, sourceId, body = {}) {
  const source = checklistDao.getChecklistById(db, sourceId);
  if (!source) {
    throw notFound(`Checklist ${sourceId} not found`, { checklist_id: sourceId });
  }
  if (!source.enabled) {
    throw conflict(`Checklist ${sourceId} is disabled and cannot be copied`, { checklist_id: sourceId });
  }

  const items = body.items === undefined ? source.items : requireChecklistItems(body.items);
  const cycleDays =
    body.cycle_days === undefined ? source.cycle_days : requirePositiveInt(body.cycle_days, 'cycle_days');

  const nextVersion = checklistDao.getMaxVersion(db, source.checklist_name) + 1;

  // Perform copy + disable source atomically.
  db.exec('BEGIN');
  try {
    const created = checklistDao.insertChecklist(db, {
      checklist_name: source.checklist_name,
      device_type: source.device_type,
      items,
      cycle_days: cycleDays,
      version: nextVersion,
      enabled: true,
    });
    checklistDao.setChecklistEnabled(db, source.id, false);
    db.exec('COMMIT');
    return created;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getChecklist(db, id) {
  const checklist = checklistDao.getChecklistById(db, id);
  if (!checklist) {
    throw notFound(`Checklist ${id} not found`, { checklist_id: id });
  }
  return checklist;
}

module.exports = { createChecklist, copyChecklistVersion, getChecklist };
