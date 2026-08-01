const { getDb } = require('../db/connection');
const checklistRepository = require('../repositories/checklistRepository');
const { ApiError } = require('../errors/ApiError');
const {
  requireFields,
  requireString,
  requirePositiveInt,
} = require('../utils/validate');

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('字段 items 必须是非空数组', { field: 'items' });
  }
  const seen = new Set();
  items.forEach((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw ApiError.badRequest('items 元素必须是对象', { index });
    }
    requireString(item.item_key, `items[${index}].item_key`);
    requireString(item.item_name, `items[${index}].item_name`);
    if (seen.has(item.item_key)) {
      throw ApiError.badRequest('items 中 item_key 重复', { item_key: item.item_key });
    }
    seen.add(item.item_key);
  });
}

function toChecklistDto(row) {
  if (!row) return row;
  return { ...row, items: JSON.parse(row.items) };
}

function createChecklist(body) {
  requireFields(body, ['checklist_name', 'device_type', 'items', 'cycle_days']);
  requireString(body.checklist_name, 'checklist_name');
  requireString(body.device_type, 'device_type');
  validateItems(body.items);
  requirePositiveInt(body.cycle_days, 'cycle_days');
  const version = body.version === undefined ? 1 : body.version;
  requirePositiveInt(version, 'version');

  const db = getDb();
  if (checklistRepository.findChecklistByNameVersion(db, body.checklist_name.trim(), version)) {
    throw ApiError.conflict('同名同版本的清单已存在', {
      checklist_name: body.checklist_name,
      version,
    });
  }

  const id = checklistRepository.insertChecklist(db, {
    checklist_name: body.checklist_name.trim(),
    device_type: body.device_type.trim(),
    items: JSON.stringify(body.items),
    cycle_days: body.cycle_days,
    version,
    created_at: new Date().toISOString(),
  });
  return toChecklistDto(checklistRepository.findChecklistById(db, id));
}

function getChecklistOrThrow(db, id) {
  const checklist = checklistRepository.findChecklistById(db, id);
  if (!checklist) {
    throw ApiError.notFound('巡检清单不存在', { checklist_id: id });
  }
  return checklist;
}

function copyChecklistVersion(id, body = {}) {
  const db = getDb();
  const source = getChecklistOrThrow(db, id);
  if (!source.enabled) {
    throw ApiError.conflict('清单已被禁用，不能复制', { checklist_id: id });
  }

  const items = body.items === undefined ? JSON.parse(source.items) : body.items;
  validateItems(items);
  const cycleDays = body.cycle_days === undefined ? source.cycle_days : body.cycle_days;
  requirePositiveInt(cycleDays, 'cycle_days');

  const nextVersion = checklistRepository.maxVersionForName(db, source.checklist_name) + 1;
  let newId;
  db.exec('BEGIN');
  try {
    newId = checklistRepository.insertChecklist(db, {
      checklist_name: source.checklist_name,
      device_type: source.device_type,
      items: JSON.stringify(items),
      cycle_days: cycleDays,
      version: nextVersion,
      created_at: new Date().toISOString(),
    });
    // 新版本生效后旧版本自动禁用，防止再从过期版本复制
    checklistRepository.setChecklistEnabled(db, id, false);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return toChecklistDto(checklistRepository.findChecklistById(db, newId));
}

module.exports = { createChecklist, copyChecklistVersion, getChecklistOrThrow, toChecklistDto, validateItems };
