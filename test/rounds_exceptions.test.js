const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, request } = require('./helpers');

let server;
let baseUrl;
let pumpDeviceId;
let pumpChecklistId;
let roundId;
let exceptionId;

before(async () => {
  ({ server, baseUrl } = await startServer());

  const device = await request(baseUrl, 'POST', '/api/v1/devices', {
    device_code: 'PUMP-A1',
    device_name: '东区一号泵',
    area: '东区',
    device_type: 'pump',
    risk_level: 'high',
  });
  pumpDeviceId = device.body.id;

  const checklist = await request(baseUrl, 'POST', '/api/v1/checklists', {
    checklist_name: '泵组巡检',
    device_type: 'pump',
    items: [
      { item_key: 'vibration', item_name: '振动检查' },
      { item_key: 'temperature', item_name: '温度检查' },
      { item_key: 'noise', item_name: '异响检查' },
    ],
    cycle_days: 7,
  });
  pumpChecklistId = checklist.body.id;
});

after(() => server.close());

test('设备类型与清单不匹配时生成轮次被拒绝', async () => {
  const fanDevice = await request(baseUrl, 'POST', '/api/v1/devices', {
    device_code: 'FAN-A1',
    device_name: '东区风机',
    area: '东区',
    device_type: 'fan',
    risk_level: 'medium',
  });
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/rounds', {
    device_id: fanDevice.body.id,
    checklist_id: pumpChecklistId,
    planned_start_at: '2026-08-01T00:00:00Z',
    planned_end_at: '2026-08-02T00:00:00Z',
    owner_name: '张三',
  });
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
});

test('生成巡检轮次成功，初始状态 scheduled', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/rounds', {
    device_id: pumpDeviceId,
    checklist_id: pumpChecklistId,
    planned_start_at: '2026-08-01T00:00:00Z',
    planned_end_at: '2026-08-03T00:00:00Z',
    owner_name: '张三',
  });
  assert.equal(status, 201);
  assert.equal(body.round_status, 'scheduled');
  assert.equal(body.owner_name, '张三');
  roundId = body.id;
});

test('禁止从 scheduled 直接关闭轮次', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/close`);
  assert.equal(status, 409);
  assert.equal(body.error_code, 'INVALID_STATE');
  assert.equal(body.details.from, 'scheduled');
  assert.equal(body.details.to, 'closed');
});

test('未开始的轮次不能提交结果', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/submit`, {
    results: [
      { item_key: 'vibration', result: 'normal' },
      { item_key: 'temperature', result: 'normal' },
      { item_key: 'noise', result: 'normal' },
    ],
  });
  assert.equal(status, 409);
  assert.equal(body.error_code, 'INVALID_STATE');
});

test('开始巡检：scheduled -> in_progress', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/start`);
  assert.equal(status, 200);
  assert.equal(body.round_status, 'in_progress');
  assert.ok(body.started_at);
});

test('重复开始巡检被拒绝', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/start`);
  assert.equal(status, 409);
  assert.equal(body.error_code, 'INVALID_STATE');
});

test('提交结果：非法结果值被拒绝', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/submit`, {
    results: [
      { item_key: 'vibration', result: 'broken' },
      { item_key: 'temperature', result: 'normal' },
      { item_key: 'noise', result: 'normal' },
    ],
  });
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
});

test('提交结果：少传检查项被拒绝', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/submit`, {
    results: [{ item_key: 'vibration', result: 'normal' }],
  });
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
  assert.equal(body.details.expected_count, 3);
  assert.equal(body.details.actual_count, 1);
});

test('提交结果：多传检查项被拒绝', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/submit`, {
    results: [
      { item_key: 'vibration', result: 'normal' },
      { item_key: 'temperature', result: 'normal' },
      { item_key: 'noise', result: 'normal' },
      { item_key: 'extra', result: 'normal' },
    ],
  });
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
  assert.equal(body.details.expected_count, 3);
  assert.equal(body.details.actual_count, 4);
});

test('提交结果：检查项顺序与清单不一致被拒绝', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/submit`, {
    results: [
      { item_key: 'temperature', result: 'normal' },
      { item_key: 'vibration', result: 'normal' },
      { item_key: 'noise', result: 'normal' },
    ],
  });
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
  assert.equal(body.details.index, 0);
  assert.equal(body.details.expected_item_key, 'vibration');
  assert.equal(body.details.actual_item_key, 'temperature');
});

test('提交结果：检查项改名与清单不一致被拒绝', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/submit`, {
    results: [
      { item_key: 'vibration', result: 'normal' },
      { item_key: 'temp', result: 'normal' },
      { item_key: 'noise', result: 'normal' },
    ],
  });
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
  assert.equal(body.details.index, 1);
  assert.equal(body.details.expected_item_key, 'temperature');
  assert.equal(body.details.actual_item_key, 'temp');
});

test('提交结果成功：轮次变为 submitted，fault 项生成待复核异常', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/submit`, {
    results: [
      { item_key: 'vibration', result: 'normal' },
      { item_key: 'temperature', result: 'fault', note: '轴承温度 95℃' },
      { item_key: 'noise', result: 'skipped', note: '夜间无法检测' },
    ],
  });
  assert.equal(status, 200);
  assert.equal(body.round_status, 'submitted');
  assert.ok(body.submitted_at);
  assert.equal(body.results.length, 3);
  assert.equal(body.results[1].result, 'fault');
  assert.equal(body.exceptions.length, 1);
  assert.equal(body.exceptions[0].exception_type, 'fault');
  assert.equal(body.exceptions[0].review_status, 'pending');
  exceptionId = body.exceptions[0].id;
});

test('重复提交结果被拒绝', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/submit`, {
    results: [
      { item_key: 'vibration', result: 'normal' },
      { item_key: 'temperature', result: 'normal' },
      { item_key: 'noise', result: 'normal' },
    ],
  });
  assert.equal(status, 409);
  assert.equal(body.error_code, 'INVALID_STATE');
});

test('存在待复核异常时不能关闭轮次', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/close`);
  assert.equal(status, 409);
  assert.equal(body.error_code, 'INVALID_STATE');
  assert.equal(body.details.unresolved_exceptions, 1);
});

test('异常复核成功', async () => {
  const { status, body } = await request(
    baseUrl,
    'POST',
    `/api/v1/exceptions/${exceptionId}/review`,
    {
      reviewer_name: '李工',
      review_result: 'resolved',
      review_comment: '轴承已更换，复检正常',
    }
  );
  assert.equal(status, 200);
  assert.equal(body.review_status, 'resolved');
  assert.equal(body.reviewer_name, '李工');
  assert.ok(body.reviewed_at);
});

test('重复复核被拒绝', async () => {
  const { status, body } = await request(
    baseUrl,
    'POST',
    `/api/v1/exceptions/${exceptionId}/review`,
    { reviewer_name: '李工', review_result: 'resolved' }
  );
  assert.equal(status, 409);
  assert.equal(body.error_code, 'INVALID_STATE');
});

test('异常复核取值非法被拒绝', async () => {
  const { status, body } = await request(
    baseUrl,
    'POST',
    `/api/v1/exceptions/${exceptionId}/review`,
    { reviewer_name: '李工', review_result: 'deferred' }
  );
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
});

test('关闭轮次：submitted -> closed', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/close`);
  assert.equal(status, 200);
  assert.equal(body.round_status, 'closed');
  assert.ok(body.closed_at);
});

test('查询设备最近轮次（含结果项）', async () => {
  const { status, body } = await request(
    baseUrl,
    'GET',
    `/api/v1/devices/${pumpDeviceId}/rounds/latest`
  );
  assert.equal(status, 200);
  assert.equal(body.id, roundId);
  assert.equal(body.round_status, 'closed');
  assert.equal(body.results.length, 3);
});

test('设备无轮次时查询最近轮次返回 404', async () => {
  const device = await request(baseUrl, 'POST', '/api/v1/devices', {
    device_code: 'METER-01',
    device_name: '西区电表',
    area: '西区',
    device_type: 'meter',
    risk_level: 'low',
  });
  const { status, body } = await request(
    baseUrl,
    'GET',
    `/api/v1/devices/${device.body.id}/rounds/latest`
  );
  assert.equal(status, 404);
  assert.equal(body.error_code, 'NOT_FOUND');
});

test('按区域查询未关闭轮次', async () => {
  const openRound = await request(baseUrl, 'POST', '/api/v1/rounds', {
    device_id: pumpDeviceId,
    checklist_id: pumpChecklistId,
    planned_start_at: '2026-08-10T00:00:00Z',
    planned_end_at: '2026-08-12T00:00:00Z',
    owner_name: '王五',
  });
  assert.equal(openRound.status, 201);

  const east = await request(baseUrl, 'GET', '/api/v1/rounds/open?area=东区');
  assert.equal(east.status, 200);
  assert.equal(east.body.rounds.length, 1);
  assert.equal(east.body.rounds[0].id, openRound.body.id);
  assert.equal(east.body.rounds[0].round_status, 'scheduled');
  assert.equal(east.body.rounds[0].device_code, 'PUMP-A1');
  assert.equal(east.body.rounds[0].pending_exceptions, 0);

  const west = await request(baseUrl, 'GET', '/api/v1/rounds/open?area=西区');
  assert.equal(west.body.rounds.length, 0);

  const noArea = await request(baseUrl, 'GET', '/api/v1/rounds/open');
  assert.equal(noArea.status, 400);
});

test('按风险等级查询异常', async () => {
  const high = await request(baseUrl, 'GET', '/api/v1/exceptions?risk_level=high');
  assert.equal(high.status, 200);
  assert.equal(high.body.exceptions.length, 1);
  assert.equal(high.body.exceptions[0].risk_level, 'high');
  assert.equal(high.body.exceptions[0].device_code, 'PUMP-A1');

  const low = await request(baseUrl, 'GET', '/api/v1/exceptions?risk_level=low');
  assert.equal(low.body.exceptions.length, 0);

  const invalid = await request(baseUrl, 'GET', '/api/v1/exceptions?risk_level=extreme');
  assert.equal(invalid.status, 400);
});

test('区域异常统计', async () => {
  const { status, body } = await request(baseUrl, 'GET', '/api/v1/stats/exceptions/by-area');
  assert.equal(status, 200);
  const east = body.stats.find((s) => s.area === '东区');
  assert.ok(east);
  assert.equal(east.total_exceptions, 1);
  assert.equal(east.fault_count, 1);
  assert.equal(east.attention_count, 0);
  assert.equal(east.pending_count, 0);
  assert.equal(east.resolved_count, 1);
});

test('停用设备后不能再生成轮次', async () => {
  const device = await request(baseUrl, 'POST', '/api/v1/devices', {
    device_code: 'PUMP-OLD',
    device_name: '退役泵',
    area: '东区',
    device_type: 'pump',
    risk_level: 'medium',
  });
  await request(baseUrl, 'PATCH', `/api/v1/devices/${device.body.id}/disable`);
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/rounds', {
    device_id: device.body.id,
    checklist_id: pumpChecklistId,
    planned_start_at: '2026-08-05T00:00:00Z',
    planned_end_at: '2026-08-06T00:00:00Z',
    owner_name: '张三',
  });
  assert.equal(status, 409);
  assert.equal(body.error_code, 'CONFLICT');
});

test('planned_end_at 早于 planned_start_at 被拒绝', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/rounds', {
    device_id: pumpDeviceId,
    checklist_id: pumpChecklistId,
    planned_start_at: '2026-08-06T00:00:00Z',
    planned_end_at: '2026-08-05T00:00:00Z',
    owner_name: '张三',
  });
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
});

test('planned_end_at 等于 planned_start_at 允许生成轮次', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/rounds', {
    device_id: pumpDeviceId,
    checklist_id: pumpChecklistId,
    planned_start_at: '2026-08-20T00:00:00Z',
    planned_end_at: '2026-08-20T00:00:00Z',
    owner_name: '张三',
  });
  assert.equal(status, 201);
  assert.equal(body.round_status, 'scheduled');
});

test('异常复核为 confirmed 时仍不能关闭轮次，未关闭轮次带待复核数量', async () => {
  const round = await request(baseUrl, 'POST', '/api/v1/rounds', {
    device_id: pumpDeviceId,
    checklist_id: pumpChecklistId,
    planned_start_at: '2026-08-21T00:00:00Z',
    planned_end_at: '2026-08-22T00:00:00Z',
    owner_name: '赵六',
  });
  const rid = round.body.id;
  await request(baseUrl, 'POST', `/api/v1/rounds/${rid}/start`);
  const submitted = await request(baseUrl, 'POST', `/api/v1/rounds/${rid}/submit`, {
    results: [
      { item_key: 'vibration', result: 'fault', note: '振动超标' },
      { item_key: 'temperature', result: 'normal' },
      { item_key: 'noise', result: 'normal' },
    ],
  });
  const excId = submitted.body.exceptions[0].id;

  // 提交后、复核前：未关闭轮次查询返回待复核异常数量 1
  const open = await request(baseUrl, 'GET', '/api/v1/rounds/open?area=东区');
  const mine = open.body.rounds.find((r) => r.id === rid);
  assert.ok(mine);
  assert.equal(mine.pending_exceptions, 1);

  // 复核为 confirmed（已确认但未处理），不允许关闭
  const reviewed = await request(baseUrl, 'POST', `/api/v1/exceptions/${excId}/review`, {
    reviewer_name: '李工',
    review_result: 'confirmed',
    review_comment: '确认振动超标，待安排检修',
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.review_status, 'confirmed');

  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${rid}/close`);
  assert.equal(status, 409);
  assert.equal(body.error_code, 'INVALID_STATE');
  assert.equal(body.details.unresolved_exceptions, 1);
});

test('全部异常复核为 resolved/ignored 后关闭成功', async () => {
  const round = await request(baseUrl, 'POST', '/api/v1/rounds', {
    device_id: pumpDeviceId,
    checklist_id: pumpChecklistId,
    planned_start_at: '2026-08-25T00:00:00Z',
    planned_end_at: '2026-08-26T00:00:00Z',
    owner_name: '王五',
  });
  const rid = round.body.id;
  await request(baseUrl, 'POST', `/api/v1/rounds/${rid}/start`);
  const submitted = await request(baseUrl, 'POST', `/api/v1/rounds/${rid}/submit`, {
    results: [
      { item_key: 'vibration', result: 'fault', note: '振动超标' },
      { item_key: 'temperature', result: 'attention', note: '温度偏高' },
      { item_key: 'noise', result: 'normal' },
    ],
  });
  assert.equal(submitted.body.exceptions.length, 2);
  const [faultExc, attentionExc] = submitted.body.exceptions;

  const r1 = await request(baseUrl, 'POST', `/api/v1/exceptions/${faultExc.id}/review`, {
    reviewer_name: '李工',
    review_result: 'resolved',
    review_comment: '已检修完成',
  });
  assert.equal(r1.status, 200);

  // 仍有一条 pending，不能关闭
  const blocked = await request(baseUrl, 'POST', `/api/v1/rounds/${rid}/close`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.details.unresolved_exceptions, 1);

  const r2 = await request(baseUrl, 'POST', `/api/v1/exceptions/${attentionExc.id}/review`, {
    reviewer_name: '李工',
    review_result: 'ignored',
    review_comment: '环境温度导致，无需处理',
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.review_status, 'ignored');

  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${rid}/close`);
  assert.equal(status, 200);
  assert.equal(body.round_status, 'closed');
  assert.ok(body.closed_at);
});
