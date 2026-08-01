const { getDb } = require('../db/connection');
const roundRepository = require('../repositories/roundRepository');
const resultRepository = require('../repositories/resultRepository');
const exceptionRepository = require('../repositories/exceptionRepository');
const deviceService = require('./deviceService');
const checklistService = require('./checklistService');
const { ApiError } = require('../errors/ApiError');
const { assertTransition } = require('../stateMachine/roundStateMachine');
const {
  requireFields,
  requireString,
  requireEnum,
  requireISODate,
} = require('../utils/validate');

const RESULT_VALUES = ['normal', 'attention', 'fault', 'skipped'];

function getRoundOrThrow(db, id) {
  const round = roundRepository.findRoundById(db, id);
  if (!round) {
    throw ApiError.notFound('巡检轮次不存在', { round_id: id });
  }
  return round;
}

// 生成轮次时固化清单快照，后续清单更新不影响历史轮次
function buildChecklistSnapshot(checklist) {
  return {
    checklist_id: checklist.id,
    checklist_name: checklist.checklist_name,
    version: checklist.version,
    device_type: checklist.device_type,
    items: JSON.parse(checklist.items),
  };
}

function toRoundDto(round) {
  if (!round) return round;
  return { ...round, checklist_snapshot: JSON.parse(round.checklist_snapshot) };
}

function createRound(body) {
  requireFields(body, [
    'device_id',
    'checklist_id',
    'planned_start_at',
    'planned_end_at',
    'owner_name',
  ]);
  if (!Number.isInteger(body.device_id) || body.device_id <= 0) {
    throw ApiError.badRequest('字段 device_id 必须是正整数', { field: 'device_id' });
  }
  if (!Number.isInteger(body.checklist_id) || body.checklist_id <= 0) {
    throw ApiError.badRequest('字段 checklist_id 必须是正整数', { field: 'checklist_id' });
  }
  requireString(body.owner_name, 'owner_name');
  const plannedStartAt = requireISODate(body.planned_start_at, 'planned_start_at');
  const plannedEndAt = requireISODate(body.planned_end_at, 'planned_end_at');
  if (plannedEndAt < plannedStartAt) {
    throw ApiError.badRequest('planned_end_at 不能早于 planned_start_at', {
      planned_start_at: plannedStartAt,
      planned_end_at: plannedEndAt,
    });
  }

  const db = getDb();
  const device = deviceService.getDeviceOrThrow(db, body.device_id);
  if (!device.enabled) {
    throw ApiError.conflict('设备已停用，无法生成巡检轮次', { device_id: device.id });
  }
  const checklist = checklistService.getChecklistOrThrow(db, body.checklist_id);
  if (checklist.device_type !== device.device_type) {
    throw ApiError.badRequest('清单适用的设备类型与目标设备不一致', {
      device_type: device.device_type,
      checklist_device_type: checklist.device_type,
    });
  }

  const now = new Date().toISOString();
  const id = roundRepository.insertRound(db, {
    device_id: body.device_id,
    checklist_id: body.checklist_id,
    checklist_snapshot: JSON.stringify(buildChecklistSnapshot(checklist)),
    planned_start_at: plannedStartAt,
    planned_end_at: plannedEndAt,
    round_status: 'scheduled',
    owner_name: body.owner_name.trim(),
    created_at: now,
    updated_at: now,
  });
  return toRoundDto(roundRepository.findRoundById(db, id));
}

function transitionRound(id, targetStatus, timestampColumn) {
  const db = getDb();
  const round = getRoundOrThrow(db, id);
  assertTransition(round.round_status, targetStatus);
  const timestamps = timestampColumn ? { [timestampColumn]: new Date().toISOString() } : {};
  roundRepository.updateRoundStatus(db, id, targetStatus, timestamps, new Date().toISOString());
  return toRoundDto(roundRepository.findRoundById(db, id));
}

function startRound(id) {
  return transitionRound(id, 'in_progress', 'started_at');
}

function closeRound(id) {
  const db = getDb();
  const round = getRoundOrThrow(db, id);
  assertTransition(round.round_status, 'closed');
  const unresolvedCount = exceptionRepository.countUnresolvedByRound(db, id);
  if (unresolvedCount > 0) {
    throw ApiError.invalidState('存在未完成复核的异常记录（需全部 ignored 或 resolved），轮次不能关闭', {
      round_id: id,
      unresolved_exceptions: unresolvedCount,
    });
  }
  roundRepository.updateRoundStatus(db, id, 'closed', { closed_at: new Date().toISOString() }, new Date().toISOString());
  return toRoundDto(roundRepository.findRoundById(db, id));
}

function submitRoundResults(id, body) {
  requireFields(body, ['results']);
  if (!Array.isArray(body.results)) {
    throw ApiError.badRequest('字段 results 必须是数组', { field: 'results' });
  }

  const db = getDb();
  const round = getRoundOrThrow(db, id);
  assertTransition(round.round_status, 'submitted');

  // 按生成轮次时固化的清单快照校验，清单后续更新不影响本轮回次
  const snapshot = JSON.parse(round.checklist_snapshot);
  const checklistItems = snapshot.items;

  // 提交的检查项数量、顺序、item_key 必须与清单 items 快照完全一致
  if (body.results.length !== checklistItems.length) {
    throw ApiError.badRequest('提交的检查项数量与清单不一致', {
      expected_count: checklistItems.length,
      actual_count: body.results.length,
    });
  }
  body.results.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw ApiError.badRequest('results 元素必须是对象', { index });
    }
    requireString(entry.item_key, `results[${index}].item_key`);
    requireEnum(entry.result, RESULT_VALUES, `results[${index}].result`);
    if (entry.note !== undefined && typeof entry.note !== 'string') {
      throw ApiError.badRequest(`results[${index}].note 必须是字符串`, { index });
    }
    const expected = checklistItems[index];
    if (entry.item_key !== expected.item_key) {
      throw ApiError.badRequest('提交的检查项与清单顺序不一致', {
        index,
        expected_item_key: expected.item_key,
        actual_item_key: entry.item_key,
      });
    }
  });
  const itemMap = new Map(checklistItems.map((item) => [item.item_key, item.item_name]));

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const entry of body.results) {
      const resultId = resultRepository.insertResult(db, {
        round_id: id,
        item_key: entry.item_key,
        item_name: itemMap.get(entry.item_key),
        result: entry.result,
        note: entry.note || '',
        created_at: now,
      });
      if (entry.result === 'attention' || entry.result === 'fault') {
        exceptionRepository.insertException(db, {
          round_id: id,
          result_id: resultId,
          device_id: round.device_id,
          exception_type: entry.result,
          created_at: now,
        });
      }
    }
    roundRepository.updateRoundStatus(db, id, 'submitted', { submitted_at: now }, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getRoundDetail(id);
}

function getRoundDetail(id) {
  const db = getDb();
  const round = getRoundOrThrow(db, id);
  const results = resultRepository.listResultsByRound(db, id);
  const exceptions = exceptionRepository
    .listExceptions(db, {})
    .filter((e) => e.round_id === id);
  return { ...toRoundDto(round), results, exceptions };
}

function getLatestRoundForDevice(deviceId) {
  const db = getDb();
  deviceService.getDeviceOrThrow(db, deviceId);
  const round = roundRepository.findLatestRoundByDevice(db, deviceId);
  if (!round) {
    throw ApiError.notFound('该设备暂无巡检轮次', { device_id: deviceId });
  }
  const results = resultRepository.listResultsByRound(db, round.id);
  return { ...toRoundDto(round), results };
}

function listOpenRoundsByArea(area) {
  requireString(area, 'area');
  const db = getDb();
  return roundRepository.findOpenRoundsByArea(db, area.trim()).map(toRoundDto);
}

module.exports = {
  RESULT_VALUES,
  createRound,
  startRound,
  closeRound,
  submitRoundResults,
  getRoundDetail,
  getLatestRoundForDevice,
  listOpenRoundsByArea,
};
